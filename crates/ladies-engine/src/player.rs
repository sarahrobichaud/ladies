use crate::state::{Chips, Status};
use ladies_core::Card;

pub struct Player {
    pub(crate) stack: Chips,
    pub(crate) bet: Chips,
    pub(crate) committed: Chips,
    pub(crate) hole: [Card; 2],
    pub(crate) status: Status,
}

impl Player {
    pub fn new(hole: [Card; 2], stack: Chips) -> Self {
        Self {
            stack,
            bet: 0,
            committed: 0,
            hole,
            status: Status::Active,
        }
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
