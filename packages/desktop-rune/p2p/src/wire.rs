//! Frames on a QUIC stream: a 4-byte big-endian length, then that many bytes of JSON.

use iroh::endpoint::{RecvStream, SendStream};
use serde_json::Value;

pub const MAX_FRAME: usize = 32 * 1024 * 1024;

pub async fn write(send: &mut SendStream, value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if body.len() > MAX_FRAME {
        return Err(format!("message is {} bytes; the most is {MAX_FRAME}", body.len()));
    }
    send.write_all(&(body.len() as u32).to_be_bytes()).await.map_err(|e| e.to_string())?;
    send.write_all(&body).await.map_err(|e| e.to_string())
}

/// The next frame, or `None` when the stream ended cleanly between frames.
pub async fn read(recv: &mut RecvStream) -> Result<Option<Value>, String> {
    let mut len = [0u8; 4];
    match recv.read(&mut len[..1]).await.map_err(|e| e.to_string())? {
        None | Some(0) => return Ok(None),
        Some(_) => {}
    }
    recv.read_exact(&mut len[1..]).await.map_err(|e| e.to_string())?;
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_FRAME {
        return Err(format!("peer sent a {len}-byte frame; the most is {MAX_FRAME}"));
    }
    let mut body = vec![0u8; len];
    recv.read_exact(&mut body).await.map_err(|e| e.to_string())?;
    serde_json::from_slice(&body).map(Some).map_err(|e| format!("peer sent a frame that isn't JSON: {e}"))
}
