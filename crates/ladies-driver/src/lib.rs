use ladies_engine::{
    Action, Blinds, Chips, GameState, GameStateInitOptions, Seat, state::TransitionError,
};

#[derive(Debug)]
pub enum SessionError {
    NoHandInProgress,
    Game(TransitionError),
}

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

    pub fn act(&mut self, action: Action) -> Result<(), SessionError> {
        let hand = self.hand.as_ref().ok_or(SessionError::NoHandInProgress)?;
        let next = hand.step_with(action).map_err(SessionError::Game)?;
        self.hand = Some(next);
        Ok(())
    }

    pub fn hand(&self) -> Option<&GameState> {
        self.hand.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use ladies_engine::Action;

    use super::*;

    #[test]
    fn a_new_session_deals_a_hand_to_the_current_stacks() {
        let blinds = Blinds::new(100, 200).expect("Good blinds");

        let mut session = Session::new(blinds, &[5000; 3]);

        session.start_hand(1);

        let hand = session.hand().expect("hand dealt");

        assert_eq!(hand.stacks(), vec![5000, 4900, 4800]);
    }

    #[test]
    fn acting_feeds_the_action_to_the_hand() {
        let blinds = Blinds::new(100, 200).unwrap();
        let mut session = Session::new(blinds, &[5000; 3]);
        session.start_hand(1);

        session.act(Action::Fold).unwrap();

        let hand = session.hand().unwrap();
        assert_eq!(hand.to_act, hand.positions.sb); // UTG folded, action on the SB
    }

    #[test]
    fn acting_without_a_hand_is_an_error() {
        let blinds = Blinds::new(100, 200).unwrap();
        let mut session = Session::new(blinds, &[5000; 3]);

        let result = session.act(Action::Fold);

        assert!(matches!(result, Err(SessionError::NoHandInProgress)));
    }
}
