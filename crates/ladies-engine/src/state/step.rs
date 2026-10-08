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

fn apply(state: &mut GameState, seat: usize, action: Action) -> Result<&GameState, GameError> {
    match action {
        Action::Play => {}
    }

    Ok(state)
}

fn advance(mut state: &mut GameState, seat: usize) -> Result<&GameState, GameError> {
    Ok(state)
}
