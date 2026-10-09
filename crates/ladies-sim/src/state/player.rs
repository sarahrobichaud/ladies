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
}
