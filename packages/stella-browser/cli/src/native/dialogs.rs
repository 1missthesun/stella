use std::io::Write;
use std::sync::{Arc, Mutex, Weak};

use serde_json::{json, Value};

use super::cdp::client::CdpClient;
use super::cdp::types::CdpEvent;

const MAX_ANSWERED: usize = 20;

#[derive(Clone, Default)]
pub struct Dialogs {
    state: Arc<Mutex<State>>,
    client: Weak<CdpClient>,
}

#[derive(Default)]
struct State {
    answered: Vec<Value>,
    held: Option<Vec<CdpEvent>>,
}

impl Dialogs {
    pub fn answer_always(client: &Arc<CdpClient>) -> Self {
        Self::watch(client, None)
    }

    pub fn answer_during_commands(client: &Arc<CdpClient>) -> Self {
        Self::watch(client, Some(Vec::new()))
    }

    fn watch(client: &Arc<CdpClient>, held: Option<Vec<CdpEvent>>) -> Self {
        let dialogs = Self {
            state: Arc::new(Mutex::new(State {
                answered: Vec::new(),
                held,
            })),
            client: Arc::downgrade(client),
        };
        let watcher = dialogs.clone();
        let mut events = client.subscribe();
        tokio::spawn(async move {
            loop {
                use tokio::sync::broadcast::error::RecvError;
                match events.recv().await {
                    Ok(event) if event.method == "Page.javascriptDialogOpening" => {
                        watcher.opened(event)
                    }
                    Ok(event) if event.method == "Page.javascriptDialogClosed" => {
                        if let Some(held) = watcher.state.lock().unwrap().held.as_mut() {
                            held.retain(|open| open.session_id != event.session_id);
                        }
                    }
                    Ok(_) | Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                }
            }
        });
        dialogs
    }

    fn opened(&self, event: CdpEvent) {
        {
            let mut state = self.state.lock().unwrap();
            if let Some(held) = state.held.as_mut() {
                held.push(event);
                return;
            }
        }
        let dialogs = self.clone();
        tokio::spawn(async move { dialogs.answer(event).await });
    }

    async fn answer(&self, event: CdpEvent) {
        let Some(client) = self.client.upgrade() else {
            return;
        };
        let field = |name: &str| event.params.get(name).and_then(Value::as_str);
        let kind = field("type").unwrap_or("alert");
        let message: String = field("message").unwrap_or("").chars().take(200).collect();
        let answer = match kind {
            "alert" => Some(json!("ok")),
            "confirm" => Some(json!(false)),
            "prompt" => Some(Value::Null),
            _ => None,
        };
        if let Some(answer) = answer {
            let mut state = self.state.lock().unwrap();
            if state.answered.len() < MAX_ANSWERED {
                state
                    .answered
                    .push(json!({ "type": kind, "message": message, "answer": answer }));
            }
        }
        let accept = kind == "beforeunload";
        let result = client
            .send_command(
                "Page.handleJavaScriptDialog",
                Some(json!({ "accept": accept })),
                event.session_id.as_deref(),
            )
            .await;
        let _ = writeln!(
            std::io::stderr(),
            "[stella-browser] auto-{} {} dialog{}",
            if accept { "accepted" } else { "dismissed" },
            kind,
            result
                .err()
                .map(|e| format!(" (failed: {})", e))
                .unwrap_or_default()
        );
    }

    pub async fn resume(&self) {
        let held = self.state.lock().unwrap().held.take();
        for event in held.unwrap_or_default() {
            self.answer(event).await;
        }
    }

    pub fn hold(&self) {
        self.state
            .lock()
            .unwrap()
            .held
            .get_or_insert_with(Vec::new);
    }

    pub fn take_answered(&self) -> Vec<Value> {
        std::mem::take(&mut self.state.lock().unwrap().answered)
    }
}
