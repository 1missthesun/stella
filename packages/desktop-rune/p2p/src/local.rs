//! Local-network discovery (mDNS, service `stella-p2p`), off until the person turns it on. Nothing
//! here sends a packet on the local network while it is off, so starting the link never makes the
//! OS ask about local network access (iOS, macOS). The endpoint gets one [`LocalLookup`] at bind;
//! turning discovery on puts an mDNS lookup into it, turning it off drops that lookup again.

use std::pin::Pin;
use std::sync::{Arc, Mutex};

use iroh::EndpointId;
use iroh::address_lookup::{AddressLookup, EndpointData, Error, Item};
use iroh_mdns_address_lookup::MdnsAddressLookup;
use tokio_stream::Stream;

use crate::lock;

#[derive(Debug, Default)]
struct Slot {
    mdns: Option<MdnsAddressLookup>,
    /// What the endpoint last published, for an mDNS lookup that starts later.
    last: Option<EndpointData>,
}

/// The endpoint's address lookup for the local network: empty while discovery is off.
#[derive(Debug, Clone, Default)]
pub(crate) struct LocalLookup(Arc<Mutex<Slot>>);

impl LocalLookup {
    pub fn is_on(&self) -> bool {
        lock(&self.0).mdns.is_some()
    }

    /// Starts mDNS (advertising this node when `advertise`); must run inside the node's runtime.
    pub fn turn_on(&self, id: EndpointId, advertise: bool) -> Result<MdnsAddressLookup, String> {
        let mut slot = lock(&self.0);
        if let Some(mdns) = &slot.mdns {
            return Ok(mdns.clone());
        }
        let mdns = MdnsAddressLookup::builder()
            .service_name("stella-p2p")
            .advertise(advertise)
            .build(id)
            .map_err(|e| format!("Local network discovery isn't available here ({e})."))?;
        if let Some(data) = &slot.last {
            mdns.publish(data);
        }
        slot.mdns = Some(mdns.clone());
        Ok(mdns)
    }

    /// Stops mDNS once the last clone of the lookup (here and in the node's watcher) is dropped.
    pub fn turn_off(&self) {
        lock(&self.0).mdns = None;
    }
}

impl AddressLookup for LocalLookup {
    fn publish(&self, data: &EndpointData) {
        let mut slot = lock(&self.0);
        slot.last = Some(data.clone());
        if let Some(mdns) = &slot.mdns {
            mdns.publish(data);
        }
    }

    fn resolve(&self, endpoint_id: EndpointId) -> Option<Pin<Box<dyn Stream<Item = Result<Item, Error>> + Send + 'static>>> {
        let mdns = lock(&self.0).mdns.clone()?;
        mdns.resolve(endpoint_id)
    }
}
