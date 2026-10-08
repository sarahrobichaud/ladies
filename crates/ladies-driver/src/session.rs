use ladies_engine::{
    Action, Blinds, Chips, GameState, GameStateInitOptions, Seat, state::TransitionError,
};

#[derive(Debug)]
pub enum SessionError {
    NoHandInProgress,
    HandInProgress,
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

    pub fn start_hand(&mut self, seed: u64) -> Result<(), SessionError> {
        if self.hand.is_some() {
            return Err(SessionError::HandInProgress);
        }

        let options = GameStateInitOptions {
            blinds: self.blinds,
            button: self.button,
        };

        let state = GameState::new(seed, &self.stacks, options);

        self.hand = Some(state);
        Ok(())
    }

    pub fn act(&mut self, action: Action) -> Result<(), SessionError> {
        let next = self
            .hand
            .as_ref()
            .ok_or(SessionError::NoHandInProgress)?
            .step_with(action)
            .map_err(SessionError::Game)?;

        if next.is_hand_over() {
            self.stacks = next.stacks();
            self.button = next_button(self.button, self.stacks.len());
            self.hand = None;
        } else {
            self.hand = Some(next);
        }

        Ok(())
    }

    pub fn hand(&self) -> Option<&GameState> {
        self.hand.as_ref()
    }

    pub fn stacks(&self) -> &[Chips] {
        &self.stacks
    }
}

fn next_button(button: Seat, table_size: usize) -> Seat {
    (button + 1) % table_size
}

#[cfg(test)]
mod tests {
    use ladies_engine::Action;

    use super::*;

    #[test]
    fn a_new_session_deals_a_hand_to_the_current_stacks() {
        let blinds = Blinds::new(100, 200).expect("good blinds");

        let mut session = Session::new(blinds, &[5000; 3]);

        session.start_hand(1).expect("hand dealt");

        let hand = session.hand().expect("hand is in progress");

        assert_eq!(hand.stacks(), vec![5000, 4900, 4800]);
    }

    #[test]
    fn acting_feeds_the_action_to_the_hand() {
        let blinds = Blinds::new(100, 200).expect("good blinds");
        let mut session = Session::new(blinds, &[5000; 3]);

        session.start_hand(1).expect("hand dealt");
        session.act(Action::Fold).unwrap();

        let hand = session
            .hand()
            .expect("hand still in progress after one fold");

        assert_eq!(hand.to_act, hand.positions.sb); // UTG folded, action on the SB
    }

    #[test]
    fn acting_without_a_hand_is_an_error() {
        let blinds = Blinds::new(100, 200).expect("good blinds");
        let mut session = Session::new(blinds, &[5000; 3]);

        let result = session.act(Action::Fold);

        assert!(matches!(result, Err(SessionError::NoHandInProgress)));
    }

    #[test]
    fn a_completed_hand_carries_stacks_back_to_the_session() {
        let blinds = Blinds::new(100, 200).expect("good blinds");
        let mut session = Session::new(blinds, &[5000; 3]);

        session.start_hand(1).expect("hand dealt");

        session.act(Action::Fold).unwrap(); // UTG
        session.act(Action::Fold).unwrap(); // SB — BB wins

        assert_eq!(session.stacks(), vec![5000, 4900, 5100]);
        assert!(session.hand().is_none()); // settled
    }

    #[test]
    fn the_button_rotates_after_a_hand() {
        let blinds = Blinds::new(100, 200).expect("good blinds");
        let mut session = Session::new(blinds, &[5000; 3]);

        session.start_hand(1).expect("first hand dealt");

        session.act(Action::Fold).unwrap(); // UTG
        session.act(Action::Fold).unwrap(); // SB — hand over

        session.start_hand(2).expect("second hand dealt");

        let hand = session.hand().expect("second hand in progress");
        assert_eq!(hand.positions.button, 1);
    }

    #[test]
    fn the_button_cycles_around_the_table() {
        assert_eq!(next_button(0, 3), 1);
        assert_eq!(next_button(1, 3), 2);
        assert_eq!(next_button(2, 3), 0); // wraparound
        assert_eq!(next_button(0, 2), 1); // heads-up: button/SB alternates
        assert_eq!(next_button(1, 2), 0);
    }

    #[test]
    fn starting_a_hand_while_one_is_in_progress_is_an_error() {
        let blinds = Blinds::new(100, 200).expect("good blinds");
        let mut session = Session::new(blinds, &[5000; 3]);
        session.start_hand(1).expect("first hand dealt");

        let result = session.start_hand(2);

        assert!(matches!(result, Err(SessionError::HandInProgress)));
    }
}
