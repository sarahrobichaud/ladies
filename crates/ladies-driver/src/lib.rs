use ladies_engine::{Blinds, Chips, GameState, GameStateInitOptions, Seat};

pub struct Session {
    button: Seat,
    blinds: Blinds,
    stacks: Vec<Chips>,
    hand: Option<GameState>,
}

impl Session {
    pub fn new(blinds: Blinds, stacks: &[Chips]) -> Self {
        Self {
            button: 0,
            blinds,
            stacks: stacks.to_vec(),
            hand: None,
        }
    }

    pub fn start_hand(&mut self, seed: u64) {
        let options = GameStateInitOptions {
            blinds: self.blinds,
            button: self.button,
        };

        let state = GameState::new(seed, &self.stacks, options);

        self.hand = Some(state);
    }

    pub fn hand(&self) -> Option<&GameState> {
        self.hand.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_session_deals_a_hand_to_the_current_stacks() {
        let blinds = Blinds::new(100, 200).expect("Good blinds");

        let mut session = Session::new(blinds, &[5000; 3]);

        session.start_hand(1);

        let hand = session.hand().expect("hand dealt");

        assert_eq!(hand.stacks(), vec![5000, 4900, 4800]);
    }
}
