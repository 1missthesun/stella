//! The phone's drawer stage (packages/mobile's DrawerStage and `lib/drawer.ts`), run in the
//! engine on the display link: its progress `v`, 0 shut to 1 open, follows a finger swiping a
//! drawer open from the page (`stageDrag: "open"` on an `edgeDrag` element) or dragging it shut
//! (`stageDrag: "close"` on a `drag` one), and springs to rest on React Native's physical
//! springs, carrying the finger's velocity. Elements with a `stage` prop are rebuilt from `v` on
//! the frame it changes, so nothing waits on TS while it moves: TS hears a swipe start (`swipe`),
//! where a lifted finger sends it (`release`), and where it comes to rest (`rest`), and sends
//! `{cmd:"stage", to, sign, travel}` to open or shut it itself.

use std::cell::RefCell;
use std::collections::{HashSet, VecDeque};
use std::time::Instant;

use serde_json::{Value, json};

use crate::engine;

/// packages/mobile's OPEN spring (Reanimated `withSpring`, physical): stiffness, damping, mass 1.
const OPEN: Spring = Spring { stiffness: 340.0, damping: 31.0, clamp: false };
/// Its CLOSE spring, with overshoot clamping.
const CLOSE: Spring = Spring { stiffness: 420.0, damping: 42.0, clamp: true };
/// RN's activeOffsetX / failOffsetY for the pan that drags an open drawer shut.
const CLOSE_ACTIVE: f32 = 12.0;
const CLOSE_FAIL: f32 = 14.0;
/// How far ahead a lifted finger's velocity carries the progress when deciding open or shut.
const FLICK_AHEAD: f32 = 0.2;
/// The window a lifted finger's velocity is measured over: its last few events, as UIKit's pan
/// velocity (a flick speeds up as it leaves the glass).
const VELOCITY_WINDOW: f64 = 0.05;

#[derive(Clone, Copy)]
struct Spring {
    stiffness: f32,
    damping: f32,
    clamp: bool,
}

struct Drag {
    origin: f32,
    sign: f32,
    /// A close drag only moves the stage once it has gone `CLOSE_ACTIVE` toward shutting.
    active: bool,
    dead: bool,
    samples: VecDeque<(f64, f32)>,
}

struct Stage {
    v: f32,
    vel: f32,
    sign: f32,
    travel: f32,
    spring: Option<(Spring, f32)>,
    drag: Option<Drag>,
    stepped: Option<Instant>,
    /// The end it last reached (true open), for the tap as it arrives there.
    at_open: bool,
    riders: HashSet<u32>,
}

thread_local! {
    /// The time of the touch being handled (seconds, the platform's clock: UITouch's timestamp).
    static TOUCH_TIME: std::cell::Cell<f64> = const { std::cell::Cell::new(0.0) };
    static STAGE: RefCell<Stage> = RefCell::new(Stage {
        v: 0.0,
        vel: 0.0,
        sign: 1.0,
        travel: 320.0,
        spring: None,
        drag: None,
        stepped: None,
        at_open: false,
        riders: HashSet::new(),
    });
}

/// Notes the time of the touch about to be handled, which a finger's velocity is measured on.
pub fn note_touch_time(t: f64) {
    TOUCH_TIME.with(|c| c.set(t));
}

fn touch_time() -> f64 {
    TOUCH_TIME.with(|c| c.get())
}

/// packages/mobile's rubber band past the open end: `(1 - 1/((over*0.6)/0.09 + 1)) * 0.09`.
fn rubber(raw: f32) -> f32 {
    if raw < 0.0 {
        0.0
    } else if raw > 1.0 {
        let over = raw - 1.0;
        1.0 + (1.0 - 1.0 / ((over * 0.6) / 0.09 + 1.0)) * 0.09
    } else {
        raw
    }
}

/// The stage's progress and its drawer's side (1 start, -1 end) on the frame being built.
pub fn stage_live() -> (f32, f32) {
    STAGE.with(|s| {
        let s = s.borrow();
        (s.v, s.sign)
    })
}

pub fn note_stage_rider(id: u32) {
    STAGE.with(|s| {
        s.borrow_mut().riders.insert(id);
    });
}

/// Whether the stage is springing, so the display link keeps ticking.
pub fn moving() -> bool {
    STAGE.with(|s| s.borrow().spring.is_some())
}

/// Rebuilds what rides the stage, on the frame about to be drawn.
fn touch_riders() {
    let riders: Vec<u32> = STAGE.with(|s| s.borrow().riders.iter().copied().collect());
    if riders.is_empty() {
        return;
    }
    let gone: Vec<u32> = engine::with(|e| {
        let mut gone = Vec::new();
        for id in riders {
            if e.tree.get(id).is_some_and(|n| n.props.stage.is_some()) {
                e.tree.touch(id);
            } else {
                gone.push(id);
            }
        }
        gone
    });
    STAGE.with(|s| {
        let mut s = s.borrow_mut();
        for id in gone {
            s.riders.remove(&id);
        }
    });
    crate::windows::mark_dirty();
}

/// Moves the stage to `v` (and side `sign`), with the tap RN gives as it reaches either end.
fn set_v(v: f32, sign: f32) {
    let changed = STAGE.with(|s| {
        let mut s = s.borrow_mut();
        let changed = (s.v - v).abs() > 1e-5 || s.sign != sign;
        s.v = v;
        s.sign = sign;
        let tap = if !s.at_open && v >= 0.985 {
            s.at_open = true;
            true
        } else if s.at_open && v <= 0.003 {
            s.at_open = false;
            true
        } else {
            false
        };
        if tap {
            crate::native::send(json!({ "t": "haptic", "kind": "light" }));
        }
        changed
    });
    if changed {
        touch_riders();
    }
}

fn spring_to(open: bool, vel: f32) {
    STAGE.with(|s| {
        let mut s = s.borrow_mut();
        s.vel = vel;
        s.spring = Some((if open { OPEN } else { CLOSE }, if open { 1.0 } else { 0.0 }));
        s.stepped = Some(Instant::now());
    });
    crate::windows::wake_all();
}

/// Steps the stage's spring to now, before the display link's frame is built.
pub fn step() {
    let Some((v, sign, rest)) = STAGE.with(|s| {
        let mut s = s.borrow_mut();
        let (spring, target) = s.spring?;
        let now = Instant::now();
        let dt = s.stepped.map_or(1.0 / 120.0, |t| now.duration_since(t).as_secs_f32()).clamp(0.0, 1.0 / 30.0);
        s.stepped = Some(now);
        let (mut x, mut vel) = (s.v, s.vel);
        let steps = (dt / 0.002).ceil().max(1.0) as usize;
        let h = dt / steps as f32;
        let mut rest = false;
        for _ in 0..steps {
            let a = -spring.stiffness * (x - target) - spring.damping * vel;
            vel += a * h;
            x += vel * h;
            if spring.clamp && (x - target) * (s.v - target) < 0.0 {
                rest = true;
                break;
            }
        }
        if rest || ((x - target).abs() < 5e-4 && vel.abs() < 5e-3) {
            x = target;
            vel = 0.0;
            rest = true;
        }
        s.vel = vel;
        if rest {
            s.spring = None;
            s.stepped = None;
        }
        Some((x, s.sign, rest.then_some(target)))
    }) else {
        return;
    };
    set_v(v, sign);
    if let Some(target) = rest {
        engine::send(json!({ "t": "stage", "kind": "rest", "v": target }));
    }
}

/// A lifted finger's velocity along the drag, points a second.
fn velocity(d: &Drag, now: f64, dx: f32) -> f32 {
    // The oldest sample within the window, or the newest before it when the window holds none
    // (events further apart than the window), unless the finger rested before lifting.
    let from = d
        .samples
        .iter()
        .find(|(t, _)| (now - *t) <= VELOCITY_WINDOW)
        .or_else(|| d.samples.back().filter(|(t, _)| (now - *t) <= VELOCITY_WINDOW * 2.0));
    match from {
        Some((t, x)) => {
            let dt = (now - *t) as f32;
            if dt > 1e-3 { (dx - x) / dt } else { 0.0 }
        }
        None => 0.0,
    }
}

fn sample(d: &mut Drag, now: f64, dx: f32) {
    d.samples.push_back((now, dx));
    while d.samples.len() > 2 && d.samples.front().is_some_and(|(t, _)| (now - *t) > VELOCITY_WINDOW * 2.0) {
        d.samples.pop_front();
    }
}

/// The finger lifted: open or shut, as RN's `progress + velocity * 0.2 > 0.5`, springing on with
/// the finger's velocity.
fn release(d: &Drag, dx: f32, cancelled: bool) {
    let now = touch_time();
    let travel = STAGE.with(|s| s.borrow().travel).max(1.0);
    let v = STAGE.with(|s| s.borrow().v);
    let vel = if cancelled { 0.0 } else { d.sign * velocity(d, now, dx) / travel };
    let open = !cancelled && v + vel * FLICK_AHEAD > 0.5;
    spring_to(open, vel);
    engine::send(json!({ "t": "stage", "kind": "release", "open": open }));
}

/// A swipe from the page's edge zone (`sign` 1 from the left, opening the start drawer).
pub fn stage_open_drag(phase: rune::Phase, dx: f32, sign: f32, cancelled: bool) {
    let now = touch_time();
    match phase {
        rune::Phase::Down => {
            let (v, cur) = stage_live();
            // A drawer still springing shut on the other side starts this one from shut.
            let origin = if (cur - sign).abs() > 0.5 && v > 0.0 { 0.0 } else { v };
            STAGE.with(|s| {
                let mut s = s.borrow_mut();
                s.spring = None;
                s.stepped = None;
                s.drag = Some(Drag { origin, sign, active: true, dead: false, samples: VecDeque::from([(now, 0.0)]) });
            });
            engine::send(json!({ "t": "stage", "kind": "swipe", "side": if sign > 0.0 { "start" } else { "end" } }));
            let travel = STAGE.with(|s| s.borrow().travel).max(1.0);
            set_v(rubber(origin + sign * dx / travel), sign);
        }
        rune::Phase::Move => {
            let Some((origin, travel)) = STAGE.with(|s| {
                let mut s = s.borrow_mut();
                let travel = s.travel.max(1.0);
                let d = s.drag.as_mut()?;
                sample(d, now, dx);
                Some((d.origin, travel))
            }) else {
                return;
            };
            set_v(rubber(origin + sign * dx / travel), sign);
        }
        rune::Phase::Up => {
            if let Some(d) = STAGE.with(|s| s.borrow_mut().drag.take()) {
                let travel = STAGE.with(|s| s.borrow().travel).max(1.0);
                if !cancelled {
                    set_v(rubber(d.origin + sign * dx / travel), sign);
                }
                release(&d, dx, cancelled);
            }
        }
    }
}

/// A drag on the open drawer or the page beside it, pulling the drawer shut (RN's close pan:
/// it takes the finger once it has gone 12 pt toward shutting, unless it went 14 pt up or down
/// first).
pub fn stage_close_drag(phase: rune::Phase, dx: f32, dy: f32, cancelled: bool) {
    let now = touch_time();
    match phase {
        rune::Phase::Down => {
            let (v, sign) = stage_live();
            if v <= 0.0 {
                return;
            }
            STAGE.with(|s| {
                s.borrow_mut().drag = Some(Drag { origin: v, sign, active: false, dead: false, samples: VecDeque::from([(now, dx)]) });
            });
        }
        rune::Phase::Move => {
            let Some((v, sign)) = STAGE.with(|s| {
                let mut s = s.borrow_mut();
                let travel = s.travel.max(1.0);
                let d = s.drag.as_mut()?;
                if d.dead {
                    return None;
                }
                if !d.active {
                    if dy.abs() >= CLOSE_FAIL {
                        d.dead = true;
                        return None;
                    }
                    if d.sign * dx > -CLOSE_ACTIVE {
                        return None;
                    }
                    d.active = true;
                    d.samples.clear();
                    // The stage stops where it is (still springing open) and follows the finger.
                    s.spring = None;
                    s.stepped = None;
                }
                let d = s.drag.as_mut()?;
                sample(d, now, dx);
                Some((rubber(d.origin + d.sign * dx / travel), d.sign))
            }) else {
                return;
            };
            set_v(v, sign);
        }
        rune::Phase::Up => {
            let Some(d) = STAGE.with(|s| s.borrow_mut().drag.take()) else { return };
            if d.active && !d.dead {
                let travel = STAGE.with(|s| s.borrow().travel).max(1.0);
                if !cancelled {
                    set_v(rubber(d.origin + d.sign * dx / travel), d.sign);
                }
                release(&d, dx, cancelled);
            }
        }
    }
}

/// `{cmd:"stage", travel?, sign?, to?}`: the drawer's travel (points), its side, and a spring
/// open (`to: 1`) or shut (`to: 0`) from wherever the stage is.
pub fn command(v: &Value) {
    if let Some(t) = v.get("travel").and_then(|x| x.as_f64()) {
        STAGE.with(|s| s.borrow_mut().travel = t as f32);
    }
    let sign = v.get("sign").and_then(|x| x.as_f64()).map(|x| if x < 0.0 { -1.0 } else { 1.0 });
    if let Some(sign) = sign {
        let (cur_v, cur) = stage_live();
        if cur != sign {
            set_v(if cur_v > 0.0 && v.get("to").and_then(|x| x.as_f64()) == Some(1.0) { 0.0 } else { cur_v }, sign);
        }
    }
    if let Some(to) = v.get("to").and_then(|x| x.as_f64()) {
        let open = to >= 0.5;
        let vel = STAGE.with(|s| {
            let mut s = s.borrow_mut();
            s.drag = None;
            s.vel
        });
        let (cur, _) = stage_live();
        if (cur - to as f32).abs() < 1e-4 && !moving() {
            engine::send(json!({ "t": "stage", "kind": "rest", "v": to }));
            return;
        }
        spring_to(open, vel);
    }
}
