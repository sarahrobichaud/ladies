use ladies_core::Card;

pub type Chips = u64;
pub type Seat = usize;


pub const SMALL_BLIND: Chips = 1;
pub const BIG_BLIND: Chips = 2;
pub const BUTTON: Seat = 0;


#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Street {
    Preflop,
    Flop,
    Turn,
    River,
    Showdown,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Status {
    Active,
    Folded,
    AllIn,
}

pub struct Player {
    stack: Chips,
    bet: Chips,
    committed: Chips,
    hole: [Card; 2],
    status: Status,
}
