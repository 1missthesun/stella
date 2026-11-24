use serde_json::{json, Value};

use super::cdp::client::{CdpClient, MAIN_WORLD_PARAM};

const PAGE_STATE_HINTS: [&str; 6] = [
    "__react",
    "_reactRootContainer",
    "__vue",
    "__ngContext__",
    "__svelte",
    "$$typeof",
];

fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

fn global_references(script: &str) -> (Vec<String>, bool) {
    let chars: Vec<char> = script.chars().collect();
    let mut names = Vec::new();
    let mut writes = false;
    let mut i = 0;
    while i < chars.len() {
        let rest: String = chars[i..chars.len().min(i + 10)].iter().collect();
        let head = ["globalThis", "window", "self"]
            .into_iter()
            .find(|word| rest.starts_with(word));
        let boundary = i == 0 || !is_ident_char(chars[i - 1]);
        let Some(head) = head.filter(|_| boundary) else {
            i += 1;
            continue;
        };
        let mut j = i + head.len();
        if j < chars.len() && is_ident_char(chars[j]) {
            i = j;
            continue;
        }
        let skip_space = |mut k: usize| {
            while k < chars.len() && chars[k].is_whitespace() {
                k += 1;
            }
            k
        };
        j = skip_space(j);
        let mut name = None;
        if j + 1 < chars.len() && chars[j] == '?' && chars[j + 1] == '.' {
            j += 2;
        } else if j < chars.len() && chars[j] == '.' {
            j += 1;
        } else if j < chars.len() && chars[j] == '[' {
            let close = chars[j..].iter().position(|c| *c == ']').map(|p| p + j);
            if let Some(close) = close {
                let inner: String = chars[j + 1..close].iter().collect();
                let inner = inner.trim();
                if inner.len() >= 2
                    && ['"', '\'', '`'].contains(&inner.chars().next().unwrap_or(' '))
                {
                    name = Some(inner[1..inner.len() - 1].to_string());
                }
                j = close + 1;
            } else {
                i = j;
                continue;
            }
        } else {
            i = j;
            continue;
        }
        if name.is_none() {
            j = skip_space(j);
            let start = j;
            while j < chars.len() && is_ident_char(chars[j]) {
                j += 1;
            }
            if j > start {
                name = Some(chars[start..j].iter().collect());
            }
        }
        let after = skip_space(j);
        if after < chars.len()
            && chars[after] == '='
            && chars.get(after + 1).is_none_or(|c| *c != '=' && *c != '>')
        {
            writes = true;
        }
        if let Some(name) = name.filter(|n| !n.is_empty()) {
            if !names.contains(&name) && names.len() < 40 {
                names.push(name);
            }
        }
        i = j.max(i + 1);
    }
    (names, writes)
}

async fn evaluate_value(
    client: &CdpClient,
    session_id: &str,
    expression: String,
    main_world: bool,
) -> Option<Value> {
    let mut params = json!({ "expression": expression, "returnByValue": true });
    if main_world {
        params[MAIN_WORLD_PARAM] = Value::Bool(true);
    }
    client
        .send_command("Runtime.evaluate", Some(params), Some(session_id))
        .await
        .ok()?
        .pointer("/result/value")
        .cloned()
}

pub async fn agent_script_in_main_world(
    client: &CdpClient,
    session_id: &str,
    script: &str,
    requested: Option<&str>,
) -> bool {
    match requested {
        Some("main") => return true,
        Some("isolated") => return false,
        _ => {}
    }
    if PAGE_STATE_HINTS.iter().any(|hint| script.contains(hint)) {
        return true;
    }
    let (names, writes) = global_references(script);
    if writes {
        return true;
    }
    if names.is_empty() {
        return false;
    }
    let list = Value::from(names).to_string();
    let missing = evaluate_value(
        client,
        session_id,
        format!("{list}.filter((name) => !(name in globalThis))"),
        false,
    )
    .await;
    let missing = match missing {
        Some(Value::Array(missing)) if !missing.is_empty() => Value::Array(missing),
        _ => return false,
    };
    evaluate_value(
        client,
        session_id,
        format!("{missing}.some((name) => name in globalThis)"),
        true,
    )
    .await
        == Some(Value::Bool(true))
}

pub fn needs_page_world(error: &str) -> bool {
    error.contains("ReferenceError")
}
