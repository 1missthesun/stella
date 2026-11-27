//! Short codes people type: the six digits a computer shows for a nearby device, and the
//! `K7M-49PX` codes that cross networks. Each is the password of a SPAKE2 exchange, so whoever
//! sits between the two (a relay, the rendezvous mailbox, a look-alike on the same network) gets
//! one guess per attempt and learns nothing it can search offline.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use spake2::{Ed25519Group, Identity, Password, Spake2};

/// Crockford's base32: no I, L, O or U, so nothing reads as something else.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// The first symbols of a short code name its mailbox; the rest are the password, never sent.
pub const SLOT_LEN: usize = 3;
pub const PASSWORD_LEN: usize = 4;

pub struct Exchange {
    state: Spake2<Ed25519Group>,
}

pub struct Keys {
    key: [u8; 32],
}

impl Exchange {
    /// `a` is the side that speaks first. Both sides name the same two identities.
    pub fn start(a: bool, password: &[u8], id_a: &[u8], id_b: &[u8]) -> (Exchange, Vec<u8>) {
        let (password, id_a, id_b) = (Password::new(password), Identity::new(id_a), Identity::new(id_b));
        let (state, msg) = if a { Spake2::<Ed25519Group>::start_a(&password, &id_a, &id_b) } else { Spake2::<Ed25519Group>::start_b(&password, &id_a, &id_b) };
        (Exchange { state }, msg)
    }

    pub fn finish(self, theirs: &[u8]) -> Result<Keys, String> {
        let shared = self.state.finish(theirs).map_err(|_| "the other side sent a broken key exchange".to_owned())?;
        let mut key = [0u8; 32];
        Hkdf::<Sha256>::new(Some(b"stella-p2p pake v1"), &shared).expand(b"key", &mut key).map_err(|e| e.to_string())?;
        Ok(Keys { key })
    }
}

impl Keys {
    fn mac(&self, label: &str) -> Hmac<Sha256> {
        let mut mac = <Hmac<Sha256> as hmac::KeyInit>::new_from_slice(&self.key).expect("hmac takes any key");
        mac.update(label.as_bytes());
        mac
    }

    /// Proof this side derived the same key, different for each side so neither can echo the other.
    pub fn confirm(&self, side: &str) -> Vec<u8> {
        self.mac(side).finalize().into_bytes().to_vec()
    }

    pub fn check(&self, side: &str, proof: &[u8]) -> bool {
        self.mac(side).verify_slice(proof).is_ok()
    }

    pub fn seal(&self, plain: &[u8]) -> Vec<u8> {
        let mut nonce = [0u8; 12];
        getrandom::fill(&mut nonce).expect("the OS has no random source");
        let cipher = ChaCha20Poly1305::new(&Key::from(self.key));
        let mut out = nonce.to_vec();
        out.extend(cipher.encrypt(&Nonce::from(nonce), plain).expect("chacha20poly1305 seals any length"));
        out
    }

    pub fn open(&self, sealed: &[u8]) -> Result<Vec<u8>, String> {
        if sealed.len() < 12 {
            return Err("the sealed offer is too short".into());
        }
        let cipher = ChaCha20Poly1305::new(&Key::from(self.key));
        let nonce: [u8; 12] = sealed[..12].try_into().map_err(|_| "the sealed offer is too short".to_owned())?;
        cipher.decrypt(&Nonce::from(nonce), &sealed[12..]).map_err(|_| "the sealed offer didn't open".to_owned())
    }
}

/// Six digits for a nearby device, without a bias towards low numbers.
pub fn six_digits() -> String {
    loop {
        let mut bytes = [0u8; 4];
        getrandom::fill(&mut bytes).expect("the OS has no random source");
        let n = u32::from_be_bytes(bytes);
        if n < u32::MAX - u32::MAX % 1_000_000 {
            return format!("{:06}", n % 1_000_000);
        }
    }
}

pub fn digits_only(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_digit()).collect()
}

pub fn random_symbols(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes).expect("the OS has no random source");
    bytes.iter().map(|b| ALPHABET[(b & 31) as usize] as char).collect()
}

/// A typed short code in canonical form: upper case, look-alikes folded (O→0, I/L→1), separators
/// dropped. `None` unless it is exactly a slot and a password.
pub fn normalize_short(code: &str) -> Option<String> {
    let mut out = String::new();
    for c in code.chars() {
        let c = match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            '-' | ' ' | '_' | '.' => continue,
            c => c,
        };
        if !ALPHABET.contains(&(c as u8)) || !c.is_ascii() {
            return None;
        }
        out.push(c);
    }
    (out.len() == SLOT_LEN + PASSWORD_LEN).then_some(out)
}

pub fn display_short(code: &str) -> String {
    format!("{}-{}", &code[..SLOT_LEN], &code[SLOT_LEN..])
}

/// The password for a short code binds its slot too, so a code means one mailbox only.
pub fn short_password(code: &str) -> Vec<u8> {
    format!("stella-p2p short v1:{}:{}", &code[..SLOT_LEN], &code[SLOT_LEN..]).into_bytes()
}
