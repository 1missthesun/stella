//! The TS → engine command buffer. One frame = `[u32 LE length][ops…]`; one frame is one React
//! commit, so the engine never sees half a commit.
//!
//! | op | bytes |
//! | --- | --- |
//! | 1 CREATE | id u32, type-len u8, type utf8 |
//! | 2 PROPS | id u32, len u32, JSON |
//! | 4 APPEND | parent u32, child u32 |
//! | 5 INSERT | parent u32, child u32, before u32 |
//! | 6 REMOVE | parent u32, child u32 (frees the child's subtree) |
//! | 9 COMMIT | generation u32, ack u32, t0 f64 (epoch ms), kind u8 |
//! | 10 CMD | len u32, JSON |

use std::io::Read;
use std::process::ChildStdout;
use std::sync::{Arc, Mutex, mpsc};

use rune::Waker;

use crate::metrics::epoch_ms;
use crate::props::{Kind, Props};

pub enum Op {
    Create { id: u32, kind: Kind },
    Props { id: u32, props: Box<Props> },
    Append { parent: u32, child: u32 },
    Insert { parent: u32, child: u32, before: u32 },
    Remove { parent: u32, child: u32 },
    /// Ends a commit. `ack` names the input event this commit answers (0: none); `t0` is when
    /// the TS side started the work (file change seen, event received); `kind` 1 = hot swap.
    Commit { generation: u32, ack: u32, t0: f64, kind: u8 },
    Cmd(serde_json::Value),
}

pub enum Msg {
    /// Ops of one frame, and when the bridge thread finished decoding it (epoch ms).
    Batch(Vec<Op>, f64),
}

struct Cur<'a> {
    b: &'a [u8],
    i: usize,
}

impl Cur<'_> {
    fn u8(&mut self) -> Option<u8> {
        let v = *self.b.get(self.i)?;
        self.i += 1;
        Some(v)
    }
    fn u32(&mut self) -> Option<u32> {
        let s = self.b.get(self.i..self.i + 4)?;
        self.i += 4;
        Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn f64(&mut self) -> Option<f64> {
        let s = self.b.get(self.i..self.i + 8)?;
        self.i += 8;
        let mut a = [0u8; 8];
        a.copy_from_slice(s);
        Some(f64::from_le_bytes(a))
    }
    fn bytes(&mut self, n: usize) -> Option<&[u8]> {
        let s = self.b.get(self.i..self.i + n)?;
        self.i += n;
        Some(s)
    }
}

fn decode(frame: &[u8]) -> Vec<Op> {
    let mut c = Cur { b: frame, i: 0 };
    let mut ops = Vec::new();
    while let Some(code) = c.u8() {
        let op = match code {
            1 => {
                let (Some(id), Some(n)) = (c.u32(), c.u8()) else { break };
                let Some(t) = c.bytes(n as usize) else { break };
                Op::Create { id, kind: Kind::parse(std::str::from_utf8(t).unwrap_or("col")) }
            }
            2 => {
                let (Some(id), Some(n)) = (c.u32(), c.u32()) else { break };
                let Some(j) = c.bytes(n as usize) else { break };
                let props = serde_json::from_slice::<Props>(j).unwrap_or_else(|e| {
                    eprintln!("stella-engine: bad props for node {id}: {e}");
                    Props::default()
                });
                Op::Props { id, props: Box::new(props) }
            }
            4 => {
                let (Some(parent), Some(child)) = (c.u32(), c.u32()) else { break };
                Op::Append { parent, child }
            }
            5 => {
                let (Some(parent), Some(child), Some(before)) = (c.u32(), c.u32(), c.u32()) else { break };
                Op::Insert { parent, child, before }
            }
            6 => {
                let (Some(parent), Some(child)) = (c.u32(), c.u32()) else { break };
                Op::Remove { parent, child }
            }
            9 => {
                let (Some(generation), Some(ack), Some(t0), Some(kind)) = (c.u32(), c.u32(), c.f64(), c.u8()) else { break };
                Op::Commit { generation, ack, t0, kind }
            }
            10 => {
                let Some(n) = c.u32() else { break };
                let Some(j) = c.bytes(n as usize) else { break };
                match serde_json::from_slice(j) {
                    Ok(v) => Op::Cmd(v),
                    Err(e) => {
                        eprintln!("stella-engine: bad command: {e}");
                        continue;
                    }
                }
            }
            other => {
                eprintln!("stella-engine: unknown op {other}; dropping the rest of the frame");
                break;
            }
        };
        ops.push(op);
    }
    ops
}

pub fn read_loop(mut out: ChildStdout, tx: mpsc::Sender<Msg>, waker: Arc<Mutex<Option<Waker>>>) {
    let mut len = [0u8; 4];
    let mut buf = Vec::new();
    loop {
        if out.read_exact(&mut len).is_err() {
            break;
        }
        let n = u32::from_le_bytes(len) as usize;
        buf.resize(n, 0);
        if out.read_exact(&mut buf).is_err() {
            break;
        }
        let ops = decode(&buf);
        if tx.send(Msg::Batch(ops, epoch_ms())).is_err() {
            break;
        }
        if let Some(w) = waker.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            w();
        }
    }
    // Disconnect wakes the UI so it can notice.
    drop(tx);
    if let Some(w) = waker.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        w();
    }
}
