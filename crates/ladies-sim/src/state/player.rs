use crate::state::Chips;
use ladies_core::Card;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Status {
    Active,
    Folded,
    AllIn,
}

#[derive(Debug, Clone)]
pub struct Player {
    pub(super) stack: Chips,
    pub(super) bet: Chips,
    pub(super) committed: Chips,
    pub(super) hole: [Card; 2],
    pub(super) status: Status,
    pub(super) needs_action: bool,
    pub(super) can_raise: bool,
}

impl Player {
    pub fn new(hole: [Card; 2], stack: Chips) -> Self {
        Self {
            stack,
            bet: 0,
            committed: 0,
            hole,
            status: Status::Active,
            needs_action: false,
            can_raise: true,
        }
    }

    pub fn can_play(&self) -> bool {
        self.status == Status::Active
    }

    pub fn can_win_pot(&self) -> bool {
        self.status != Status::Folded
    }

    pub fn post(&mut self, amount: Chips) {
        let bet = amount.min(self.stack);

        self.bet += bet;
        self.committed += bet;
        self.stack -= bet;

        if self.stack == 0 {
            self.status = Status::AllIn;
        }
    }

    pub fn stack(&self) -> Chips {
        self.stack
    }
    pub fn bet(&self) -> Chips {
        self.bet
    }
    pub fn committed(&self) -> Chips {
        self.committed
    }
    pub fn hole(&self) -> &[Card; 2] {
        &self.hole
    }
    pub fn status(&self) -> Status {
        self.status
    }
    pub fn needs_action(&self) -> bool {
        self.needs_action
    }
    pub fn can_raise(&self) -> bool {
        self.can_raise
    }
}
