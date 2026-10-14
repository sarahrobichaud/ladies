use ladies_session::{Session, SessionError};
use ladies_sim::{Action, Blinds, Chips, Seat, Status};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use ladies_core::{Card, Suit};

#[derive(Serialize)]
struct CardDto {
    rank: u8,
    suit: &'static str,
}

fn card_dto(card: Card) -> CardDto {
    CardDto {
        rank: card.rank as u8,
        suit: suit_name(card.suit),
    }
}

fn suit_name(suit: Suit) -> &'static str {
    match suit {
        Suit::Heart => "heart",
        Suit::Club => "club",
        Suit::Spade => "spade",
        Suit::Diamond => "diamond",
    }
}

#[derive(Serialize)]
struct SessionSnapshot {
    stacks: Vec<Chips>,
    hand: Option<HandSnapshot>,
}

#[derive(Serialize)]
struct BlindsDto {
    small: Chips,
    big: Chips,
}

#[derive(Serialize)]
struct HandSnapshot {
    blinds: BlindsDto,
    street: &'static str,
    to_act: Seat,
    current_bet: Chips,
    min_raise: Chips,
    pot: Chips,
    board: Vec<CardDto>,
    button: Seat,
    players: Vec<PlayerSnapshot>,
}

#[derive(Serialize)]
struct PlayerSnapshot {
    stack: Chips,
    bet: Chips,
    committed: Chips,
    hole: [CardDto; 2],
    status: &'static str,
    needs_action: bool,
    can_raise: bool,
}

fn street_name(street: &ladies_sim::Street) -> &'static str {
    use ladies_sim::Street::*;
    match street {
        Preflop => "preflop",
        Flop => "flop",
        Turn => "turn",
        River => "river",
        Complete => "complete",
        Showdown => "showdown",
    }
}

fn status_name(status: Status) -> &'static str {
    match status {
        Status::Active => "active",
        Status::Folded => "folded",
        Status::AllIn => "all-in",
    }
}

fn err(e: SessionError) -> JsError {
    JsError::new(match e {
        SessionError::NoHandInProgress => "no hand in progress",
        SessionError::HandInProgress => "a hand is already in progress",
        SessionError::Action(_) => "illegal action",
    })
}

#[wasm_bindgen]
pub struct WasmSession {
    inner: Session,
}

#[wasm_bindgen]
impl WasmSession {
    #[wasm_bindgen(constructor)]
    pub fn new(small: Chips, big: Chips, stacks: Vec<Chips>) -> Result<WasmSession, JsError> {
        console_error_panic_hook::set_once();
        let blinds = Blinds::new(small, big).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Self {
            inner: Session::new(blinds, &stacks),
        })
    }

    pub fn start_hand(&mut self, seed: u64) -> Result<(), JsError> {
        self.inner.start_hand(seed).map_err(err)
    }

    pub fn fold(&mut self) -> Result<(), JsError> {
        self.inner.act(Action::Fold).map_err(err)
    }

    pub fn check(&mut self) -> Result<(), JsError> {
        self.inner.act(Action::Check).map_err(err)
    }

    pub fn call(&mut self) -> Result<(), JsError> {
        self.inner.act(Action::Call).map_err(err)
    }

    pub fn raise_to(&mut self, to: Chips) -> Result<(), JsError> {
        self.inner.act(Action::Raise { to }).map_err(err)
    }

    pub fn all_in(&mut self) -> Result<(), JsError> {
        self.inner.act(Action::AllIn).map_err(err)
    }

    /// A plain JS object describing everything the UI needs.
    pub fn snapshot(&self) -> Result<JsValue, JsError> {
        let snapshot = SessionSnapshot {
            stacks: self.inner.stacks().to_vec(),
            hand: self.inner.hand().map(|hand| HandSnapshot {
                blinds: BlindsDto {
                    small: hand.blinds.small(),
                    big: hand.blinds.big(),
                },
                street: street_name(&hand.street),
                to_act: hand.to_act,
                current_bet: hand.current_bet,
                min_raise: hand.min_raise,
                pot: hand.pot(),
                board: hand.board.iter().copied().map(card_dto).collect(),
                button: hand.positions.button,
                players: hand
                    .players
                    .iter()
                    .map(|p| PlayerSnapshot {
                        stack: p.stack(),
                        bet: p.bet(),
                        committed: p.committed(),
                        hole: p.hole().map(card_dto),
                        status: status_name(p.status()),
                        needs_action: p.needs_action(),
                        can_raise: p.can_raise(),
                    })
                    .collect(),
            }),
        };
        serde_wasm_bindgen::to_value(&snapshot).map_err(Into::into)
    }
}
