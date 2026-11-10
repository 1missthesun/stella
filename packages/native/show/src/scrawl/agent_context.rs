//! Scrawl's `agentContext` experiment is off in Stella; `sketch` asks for it only when on.

use crate::model::ScrawlBundle;

pub struct FrameText {
    pub head: String,
    pub lines: Vec<String>,
}

pub fn keyframe_texts(_bundle: &ScrawlBundle) -> Vec<FrameText> {
    Vec::new()
}
