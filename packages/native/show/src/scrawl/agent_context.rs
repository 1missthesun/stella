use crate::model::ScrawlBundle;

pub struct FrameText {
    pub head: String,
    pub lines: Vec<String>,
}

pub fn keyframe_texts(_bundle: &ScrawlBundle) -> Vec<FrameText> {
    Vec::new()
}
