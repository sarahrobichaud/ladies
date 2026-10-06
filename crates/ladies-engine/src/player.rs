use ladies_core::Card;
use crate::state::{Chips,Status};

pub struct Player {
    stack: Chips,
    pub(crate) bet: Chips,
    pub(crate) committed: Chips,
    hole: [Card; 2],
    status: Status,
}

impl Player {

    pub fn new(hole: [Card; 2], stack: Chips) -> Self {
        Self {
            stack,
            bet: 0,
            committed: 0,
            hole,
            status: Status::Active
        }
    }

    pub fn post(&mut self, amount: Chips) {
        let bet = if amount > self.stack {
            self.stack
        } else {
            amount
        };

        self.bet = bet;
        self.committed += bet;
        self.stack -= bet;

        if self.stack == 0 {
            self.status = Status::AllIn;
        }
    }
}
