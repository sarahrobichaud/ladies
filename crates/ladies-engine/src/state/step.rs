use crate::state::Seat;
use crate::state::player::Status;

use super::GameState;
use super::action::Action;
use super::action::GameError;

pub fn step(state: &GameState, action: Action) -> Result<GameState, GameError> {
    let mut next = state.clone();
    let seat = next.to_act;

    apply(&mut next, seat, action)?;
    advance(&mut next, seat)?;

    Ok(next)
}

fn apply(mutation: &mut GameState, seat: Seat, action: Action) -> Result<&GameState, GameError> {
    let subject = &mut mutation.players[seat];

    match action {
        Action::Fold => {
            subject.status = Status::Folded;
            subject.needs_action = false;
        }
    }

    Ok(mutation)
}

fn advance(mut mutation: &mut GameState, seat: Seat) -> Result<&GameState, GameError> {
    mutation.to_act = super::next_active_from(seat, &mutation.players);
    Ok(mutation)
}

#[cfg(test)]
mod tests {
    use crate::state::{Blinds, GameState, GameStateInitOptions, action::Action, step::step};

    const OPTIONS: GameStateInitOptions = GameStateInitOptions {
        button: 0,
        blinds: Blinds {
            small: 100,
            big: 200,
        },
    };

    #[test]
    fn fold_puts_a_player_out_of_play() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);
        let utg = state.to_act;

        let next = step(&state, Action::Fold).unwrap();

        assert!(!next.players[utg].can_play());
        assert!(!next.players[utg].needs_action);
    }

    #[test]
    fn fold_passes_action_to_the_next_player() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);

        let next = step(&state, Action::Fold).unwrap();

        assert_eq!(next.to_act, state.positions.sb);
    }
}
