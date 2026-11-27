//! `location.get {timeoutMs?}`: where the device is, from the OS location service. On Linux that
//! is GeoClue over the system bus (its agent asks the user where the desktop has one); elsewhere,
//! or when GeoClue isn't running, the reply is an error and the host falls back to IP location.
//! Replies `{latitude, longitude, accuracy, source}`; accuracy in metres.

use serde_json::{Value, json};

pub fn command(rid: Option<u64>, v: &Value) {
    let timeout = v.get("timeoutMs").and_then(|t| t.as_u64()).unwrap_or(10_000).clamp(500, 30_000);
    std::thread::spawn(move || {
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = send.send(locate());
        });
        let result = receive
            .recv_timeout(std::time::Duration::from_millis(timeout))
            .unwrap_or_else(|_| Err(format!("the location service didn't answer within {} s", timeout / 1000)));
        crate::engine::reply_any_thread(rid, result);
    });
}

#[cfg(target_os = "linux")]
fn locate() -> Result<Value, String> {
    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::OwnedObjectPath;
    const BUS: &str = "org.freedesktop.GeoClue2";
    let err = |e: zbus::Error| e.to_string();
    let conn = Connection::system().map_err(err)?;
    let manager = Proxy::new(&conn, BUS, "/org/freedesktop/GeoClue2/Manager", "org.freedesktop.GeoClue2.Manager").map_err(err)?;
    let path: OwnedObjectPath = manager.call("GetClient", &()).map_err(|e| format!("GeoClue isn't available: {e}"))?;
    let client = Proxy::new(&conn, BUS, path.as_str().to_owned(), "org.freedesktop.GeoClue2.Client").map_err(err)?;
    client.set_property("DesktopId", "stella").map_err(|e| e.to_string())?;
    // GCLUE_ACCURACY_LEVEL_EXACT.
    client.set_property("RequestedAccuracyLevel", 8u32).map_err(|e| e.to_string())?;
    let mut updates = client.receive_signal("LocationUpdated").map_err(err)?;
    client.call::<_, _, ()>("Start", &()).map_err(|e| format!("GeoClue refused: {e}"))?;
    let mut at: OwnedObjectPath = client.get_property("Location").map_err(err)?;
    if at.as_str() == "/" {
        let signal = updates.next().ok_or("GeoClue stopped before it had a location")?;
        let (_old, new): (OwnedObjectPath, OwnedObjectPath) = signal.body().deserialize().map_err(err)?;
        at = new;
    }
    let location = Proxy::new(&conn, BUS, at.as_str().to_owned(), "org.freedesktop.GeoClue2.Location").map_err(err)?;
    let latitude: f64 = location.get_property("Latitude").map_err(err)?;
    let longitude: f64 = location.get_property("Longitude").map_err(err)?;
    let accuracy: f64 = location.get_property("Accuracy").map_err(err)?;
    let _ = client.call::<_, _, ()>("Stop", &());
    Ok(json!({ "latitude": latitude, "longitude": longitude, "accuracy": accuracy, "source": "geoclue" }))
}

#[cfg(not(target_os = "linux"))]
fn locate() -> Result<Value, String> {
    Err("no location service here".to_owned())
}
