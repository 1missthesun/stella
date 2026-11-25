//! The retained mirror of the TS element tree. Root children are `<window>` nodes; every
//! mutation bumps versions up to the root and marks the owning window dirty.

use std::collections::{BTreeSet, HashMap, HashSet};

use crate::props::{Kind, Props};
use crate::protocol::Op;

#[derive(Default)]
pub struct Node {
    pub kind: Kind,
    pub props: Box<Props>,
    pub children: Vec<u32>,
    pub parent: u32,
    /// Bumped whenever this node or anything under it changes; the memo version.
    pub ver: u64,
}

#[derive(Default)]
pub struct Tree {
    pub nodes: HashMap<u32, Node>,
    clock: u64,
    /// Windows (root children) whose subtree changed since the last take.
    pub dirty: HashSet<u32>,
    /// Nodes removed since the last take (webviews and inputs drop their native state).
    pub removed: Vec<u32>,
    /// Nodes built at their window's root (fixed layers, anchored overlays), in creation order.
    pub lifted: BTreeSet<u32>,
    /// Nodes whose element carries state the window keeps (inputs, media, webviews).
    live: HashSet<u32>,
    /// Ancestors of live nodes: never memoized, since a cached subtree would hold stale state.
    pub live_above: HashSet<u32>,
    /// Each webview's nearest scrolling or clipping ancestor, which its native view must stay inside.
    pub clip_of: HashMap<u32, u32>,
    pub clippers: HashSet<u32>,
    live_moved: bool,
}

impl Tree {
    pub fn new() -> Self {
        let mut t = Tree::default();
        t.nodes.insert(0, Node { kind: Kind::Col, ..Default::default() });
        t
    }

    pub fn get(&self, id: u32) -> Option<&Node> {
        self.nodes.get(&id)
    }

    /// The `<window>` node above `id` (itself for a window), if attached.
    pub fn window_of(&self, mut id: u32) -> Option<u32> {
        for _ in 0..4096 {
            let n = self.nodes.get(&id)?;
            if n.parent == 0 {
                return self.nodes.get(&0).filter(|r| r.children.contains(&id)).map(|_| id);
            }
            id = n.parent;
        }
        None
    }

    /// Lifted nodes shown in `window`.
    pub fn lifted_in(&self, window: u32) -> Vec<u32> {
        self.lifted.iter().copied().filter(|n| self.window_of(*n) == Some(window)).collect()
    }

    /// The node whose `id` prop is `key`.
    pub fn find_key(&self, key: &str) -> Option<u32> {
        self.nodes.iter().find(|(_, n)| n.props.id.as_deref() == Some(key)).map(|(id, _)| *id)
    }

    /// Recomputes `live_above` after the tree's shape changed.
    pub fn settle(&mut self) {
        if !std::mem::take(&mut self.live_moved) {
            return;
        }
        self.live_above.clear();
        self.clip_of.clear();
        self.clippers.clear();
        for &l in &self.live {
            if self.nodes.get(&l).is_some_and(|n| n.kind == Kind::Webview)
                && let Some(c) = self.clipper_above(l)
            {
                self.clip_of.insert(l, c);
                self.clippers.insert(c);
            }
            let mut id = self.nodes.get(&l).map_or(0, |n| n.parent);
            for _ in 0..4096 {
                if id == 0 || !self.live_above.insert(id) {
                    break;
                }
                id = self.nodes.get(&id).map_or(0, |n| n.parent);
            }
        }
    }

    fn clipper_above(&self, id: u32) -> Option<u32> {
        let mut id = self.nodes.get(&id)?.parent;
        for _ in 0..4096 {
            let n = self.nodes.get(&id)?;
            if id == 0 || n.kind == Kind::Window {
                return None;
            }
            if n.props.scroll_y || n.props.scroll_x || n.props.clip.is_some() {
                return Some(id);
            }
            id = n.parent;
        }
        None
    }

    fn touch(&mut self, mut id: u32) {
        self.clock += 1;
        let v = self.clock;
        for _ in 0..4096 {
            let Some(n) = self.nodes.get_mut(&id) else { return };
            n.ver = v;
            if id == 0 {
                return;
            }
            let parent = n.parent;
            if parent == 0 {
                self.dirty.insert(id);
            }
            id = parent;
        }
    }

    fn detach(&mut self, parent: u32, child: u32) {
        if let Some(p) = self.nodes.get_mut(&parent) {
            p.children.retain(|c| *c != child);
        }
    }

    fn destroy(&mut self, id: u32) {
        if let Some(n) = self.nodes.remove(&id) {
            self.removed.push(id);
            self.lifted.remove(&id);
            if self.live.remove(&id) {
                self.live_moved = true;
            }
            for c in n.children {
                self.destroy(c);
            }
        }
    }

    fn detach_from_old(&mut self, child: u32) {
        if let Some(old) = self.nodes.get(&child).map(|c| c.parent)
            && self.nodes.get(&old).is_some_and(|p| p.children.contains(&child))
        {
            self.detach(old, child);
            self.touch(old);
        }
    }

    pub fn apply(&mut self, op: Op) {
        match op {
            Op::Create { id, kind } => {
                if matches!(kind, Kind::Input | Kind::Video | Kind::Webview) {
                    self.live.insert(id);
                }
                self.nodes.insert(id, Node { kind, ..Default::default() });
            }
            Op::Props { id, props } => {
                if self.live_above.contains(&id) {
                    self.live_moved = true;
                }
                if props.lifted() {
                    self.lifted.insert(id);
                } else {
                    self.lifted.remove(&id);
                }
                if let Some(n) = self.nodes.get_mut(&id) {
                    n.props = props;
                }
                self.touch(id);
            }
            Op::Append { parent, child } => {
                self.live_moved = true;
                self.detach_from_old(child);
                if let Some(p) = self.nodes.get_mut(&parent) {
                    p.children.push(child);
                }
                if let Some(c) = self.nodes.get_mut(&child) {
                    c.parent = parent;
                }
                self.touch(child);
            }
            Op::Insert { parent, child, before } => {
                self.live_moved = true;
                self.detach_from_old(child);
                if let Some(p) = self.nodes.get_mut(&parent) {
                    let at = p.children.iter().position(|c| *c == before).unwrap_or(p.children.len());
                    p.children.insert(at, child);
                }
                if let Some(c) = self.nodes.get_mut(&child) {
                    c.parent = parent;
                }
                self.touch(child);
            }
            Op::Remove { parent, child } => {
                self.live_moved = true;
                if parent == 0 {
                    self.dirty.insert(child);
                }
                self.detach(parent, child);
                self.destroy(child);
                self.touch(parent);
            }
            Op::Commit { .. } | Op::Cmd(_) | Op::Blob { .. } | Op::FreeBlob { .. } => {}
        }
    }
}
