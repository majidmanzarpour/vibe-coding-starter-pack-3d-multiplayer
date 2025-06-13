/**
 * Vibe Coding Starter Pack: 3D Multiplayer - lib.rs
 *
 * Main entry point for the SpacetimeDB module. This file contains:
 *
 * 1. Database Schema:
 *    - PlayerData: Active player information
 *    - LoggedOutPlayerData: Persistent data for disconnected players
 *    - GameTickSchedule: Periodic update scheduling
 *    - NpcData: Information about Non-Player Characters
 *    - PlayerNpcInteraction: Log of conversations between players and NPCs
 *
 * 2. Reducer Functions (Server Endpoints):
 *    - init: Module initialization and game tick scheduling, NPC spawning
 *    - identity_connected/disconnected: Connection lifecycle management
 *    - register_player: Player registration with username and character class
 *    - update_player_input: Processes player movement and state updates
 *    - game_tick: Periodic update for game state (scheduled)
 *    - spawn_npc: Creates a new NPC in the game world
 *    - player_speaks_to_npc: Logs a message from a player to an NPC
 *    - npc_responds_to_player: Logs a message from an NPC to a player (typically after LLM processing)
 *
 * 3. Table Structure:
 *    - All tables use Identity as primary keys where appropriate
 *    - Connection between tables maintained through identity references or explicit IDs
 *
 * When modifying:
 *    - Table changes require regenerating TypeScript bindings
 *    - Add `public` tag to tables that need client access
 *    - New reducers should follow naming convention and error handling patterns
 *    - Game logic should be placed in separate modules (like player_logic.rs)
 *    - Extend game_tick for gameplay systems that need periodic updates
 *
 * Related files:
 *    - common.rs: Shared data structures used in table definitions
 *    - player_logic.rs: Player movement and state update calculations
 */

// Declare modules
mod common;
mod player_logic;

use spacetimedb::{ReducerContext, Identity, Table, Timestamp, ScheduleAt, spacetimedb};
use std::time::Duration; // Import standard Duration

// Use items from common module (structs are needed for table definitions)
use crate::common::{Vector3, InputState};

// --- Schema Definitions ---

#[spacetimedb::table(name = player, public)]
#[derive(Clone)]
pub struct PlayerData {
    #[primary_key]
    identity: Identity,
    username: String,
    character_class: String,
    position: Vector3,
    rotation: Vector3,
    health: i32,
    max_health: i32,
    mana: i32,
    max_mana: i32,
    current_animation: String,
    is_moving: bool,
    is_running: bool,
    is_attacking: bool,
    is_casting: bool,
    last_input_seq: u32,
    input: InputState,
    color: String,
}

#[spacetimedb::table(name = logged_out_player)]
#[derive(Clone)]
pub struct LoggedOutPlayerData {
    #[primary_key]
    identity: Identity,
    username: String,
    character_class: String,
    position: Vector3,
    rotation: Vector3,
    health: i32,
    max_health: i32,
    mana: i32,
    max_mana: i32,
    last_seen: Timestamp,
}

#[spacetimedb::table(name = game_tick_schedule, public, scheduled(game_tick))]
pub struct GameTickSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

#[spacetimedb::table(name = npc, public)]
#[derive(Clone)]
pub struct NpcData {
    #[primary_key]
    #[auto_inc]
    npc_id: u64,
    name: String,
    model_name: String, // e.g., "wizard", "paladin"
    position: Vector3,
    dialogue_greeting: String, // Initial greeting or personality prompt for LLM
}

#[spacetimedb::table(name = player_npc_interaction_log, public)]
#[derive(Clone)]
pub struct PlayerNpcInteraction {
    #[primary_key]
    #[auto_inc]
    interaction_id: u64,
    npc_id: u64,
    player_identity: Identity,
    speaker: String, // "player" or "npc"
    message: String,
    timestamp: Timestamp,
}


// --- Lifecycle Reducers ---

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) -> Result<(), String> {
    spacetimedb::log::info!("[INIT] Initializing Vibe Multiplayer module...");
    if ctx.db.game_tick_schedule().count() == 0 {
        spacetimedb::log::info!("[INIT] Scheduling initial game tick (every 1 second)...");
        let loop_duration = Duration::from_secs(1);
        let schedule = GameTickSchedule {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(loop_duration.into()),
        };
        match ctx.db.game_tick_schedule().try_insert(schedule) {
            Ok(row) => spacetimedb::log::info!("[INIT] Game tick schedule inserted successfully. ID: {}", row.scheduled_id),
            Err(e) => spacetimedb::log::error!("[INIT] FAILED to insert game tick schedule: {}", e),
        }
    } else {
        spacetimedb::log::info!("[INIT] Game tick already scheduled.");
    }

    // Spawn a default NPC if none exist
    if ctx.db.npc().count() == 0 {
        spacetimedb::log::info!("[INIT] Spawning initial NPC...");
        spawn_npc_internal(
            ctx,
            "Merlin".to_string(),
            "wizard".to_string(),
            Vector3 { x: 5.0, y: 0.0, z: 5.0 },
            "Greetings traveler! I am Merlin. Ask me anything, but be warned, my knowledge is as vast and unpredictable as the cosmos itself.".to_string()
        )?; // Propagate error if spawn fails
    }


    Ok(())
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) {
    spacetimedb::log::info!("Client connected: {}", ctx.sender);
    // Player registration/re-joining happens in register_player reducer called by client
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    let player_identity: Identity = ctx.sender;
    spacetimedb::log::info!("Client disconnected: {}", player_identity);
    let logout_time: Timestamp = ctx.timestamp;

    if let Some(player) = ctx.db.player().identity().find(player_identity) {
        spacetimedb::log::info!("Moving player {} to logged_out_player table.", player_identity);
        let logged_out_player = LoggedOutPlayerData {
            identity: player.identity,
            username: player.username.clone(),
            character_class: player.character_class.clone(),
            position: player.position.clone(),
            rotation: player.rotation.clone(),
            health: player.health,
            max_health: player.max_health,
            mana: player.mana,
            max_mana: player.max_mana,
            last_seen: logout_time,
        };
        ctx.db.logged_out_player().insert(logged_out_player);
        ctx.db.player().identity().delete(player_identity);
    } else {
        spacetimedb::log::warn!("Disconnect by player {} not found in active player table.", player_identity);
        if let Some(mut logged_out_player) = ctx.db.logged_out_player().identity().find(player_identity) {
            logged_out_player.last_seen = logout_time;
            ctx.db.logged_out_player().identity().update(logged_out_player);
            spacetimedb::log::warn!("Updated last_seen for already logged out player {}.", player_identity);
        }
    }
}

// --- Game Specific Reducers ---

// Internal function for NPC spawning, not directly exposed as a reducer if only called from init.
// If we want clients to spawn NPCs, we'd make a separate public reducer.
fn spawn_npc_internal(
    ctx: &ReducerContext,
    name: String,
    model_name: String,
    position: Vector3,
    dialogue_greeting: String,
) -> Result<(), String> {
    spacetimedb::log::info!("Spawning NPC: {} ({}) at {:?}", name, model_name, position);
    ctx.db.npc().insert(NpcData {
        npc_id: 0, // auto_inc will handle this
        name,
        model_name,
        position,
        dialogue_greeting,
    }).map_err(|e| format!("Failed to spawn NPC: {}", e))?;
    Ok(())
}


#[spacetimedb::reducer]
pub fn register_player(ctx: &ReducerContext, username: String, character_class: String) {
    let player_identity: Identity = ctx.sender;
    spacetimedb::log::info!(
        "Registering player {} ({}) with class {}",
        username,
        player_identity,
        character_class
    );

    if ctx.db.player().identity().find(player_identity).is_some() {
        spacetimedb::log::warn!("Player {} is already active.", player_identity);
        return;
    }

    // Assign color and position based on current player count
    let player_count = ctx.db.player().iter().count();
    let colors = ["cyan", "magenta", "yellow", "lightgreen", "white", "orange"];
    let assigned_color = colors[player_count % colors.len()].to_string();
    // Simple horizontal offset for spawning, start Y at 1.0
    let spawn_position = Vector3 { x: (player_count as f32 * 2.0) - 1.0, y: 1.0, z: 0.0 }; // Adjusted spacing

    if let Some(logged_out_player) = ctx.db.logged_out_player().identity().find(player_identity) {
        spacetimedb::log::info!("Player {} is rejoining.", player_identity);
        let default_input = InputState {
            forward: false, backward: false, left: false, right: false,
            sprint: false, jump: false, attack: false, cast_spell: false,
            sequence: 0
        };
        let rejoining_player = PlayerData {
            identity: logged_out_player.identity,
            username: logged_out_player.username.clone(),
            character_class: logged_out_player.character_class.clone(),
            position: spawn_position, // Use new spawn position
            rotation: logged_out_player.rotation.clone(),
            health: logged_out_player.health,
            max_health: logged_out_player.max_health,
            mana: logged_out_player.mana,
            max_mana: logged_out_player.max_mana,
            current_animation: "idle".to_string(),
            is_moving: false,
            is_running: false,
            is_attacking: false,
            is_casting: false,
            last_input_seq: 0,
            input: default_input,
            color: assigned_color,
        };
        ctx.db.player().insert(rejoining_player);
        ctx.db.logged_out_player().identity().delete(player_identity);
    } else {
        spacetimedb::log::info!("Registering new player {}.", player_identity);
        let default_input = InputState {
            forward: false, backward: false, left: false, right: false,
            sprint: false, jump: false, attack: false, cast_spell: false,
            sequence: 0
        };
        ctx.db.player().insert(PlayerData {
            identity: player_identity,
            username,
            character_class,
            position: spawn_position,
            rotation: Vector3 { x: 0.0, y: 0.0, z: 0.0 },
            health: 100,
            max_health: 100,
            mana: 100,
            max_mana: 100,
            current_animation: "idle".to_string(),
            is_moving: false,
            is_running: false,
            is_attacking: false,
            is_casting: false,
            last_input_seq: 0,
            input: default_input,
            color: assigned_color,
        });
    }
}

#[spacetimedb::reducer]
pub fn update_player_input(
    ctx: &ReducerContext,
    input: InputState,
    _client_pos: Vector3, // client_pos is acknowledged but not strictly enforced on server
    client_rot: Vector3,
    client_animation: String,
) {
    if let Some(mut player) = ctx.db.player().identity().find(ctx.sender) {
        // Basic validation for sequence to prevent out-of-order inputs (optional)
        // if input.sequence <= player.last_input_seq && input.sequence != 0 { // allow 0 for initial
        //     spacetimedb::log::warn!("Stale input received for player {}. Seq: {}, LastSeq: {}", ctx.sender, input.sequence, player.last_input_seq);
        //     return;
        // }
        
        player_logic::update_input_state(&mut player, input, client_rot, client_animation);
        ctx.db.player().identity().update(player);

    } else {
        spacetimedb::log::warn!("Player {} tried to update input but is not active.", ctx.sender);
    }
}

#[spacetimedb::reducer(update)]
pub fn game_tick(ctx: &ReducerContext, _tick_info: GameTickSchedule) {
    let delta_time = 1.0; // Fixed 1-second tick for simplicity for now
                          // In a real game, this would be calculated from ctx.timestamp and previous tick time.
    
    player_logic::update_players_logic(ctx, delta_time);
    
    // spacetimedb::log::debug!("Game tick completed"); // Can be noisy, enable if needed
}


// --- NPC Interaction Reducers ---

#[spacetimedb::reducer]
pub fn player_speaks_to_npc(ctx: &ReducerContext, npc_id: u64, message: String) -> Result<(), String> {
    let player_identity = ctx.sender;

    // Check if NPC exists
    if ctx.db.npc().filter_by_npc_id(npc_id).is_none() {
        return Err(format!("NPC with ID {} not found.", npc_id));
    }
    
    // Check if Player exists (should always be true if called by a connected client)
    if ctx.db.player().filter_by_identity(player_identity).is_none() {
         return Err(format!("Player with ID {} not found, cannot speak to NPC.", player_identity));
    }

    spacetimedb::log::info!("Player {} says to NPC {}: '{}'", player_identity, npc_id, message);

    ctx.db.player_npc_interaction_log().insert(PlayerNpcInteraction {
        interaction_id: 0, // auto_inc
        npc_id,
        player_identity,
        speaker: "player".to_string(),
        message,
        timestamp: ctx.timestamp,
    }).map_err(|e| format!("Failed to log player message: {}", e))?;

    Ok(())
}

#[spacetimedb::reducer]
pub fn npc_responds_to_player(ctx: &ReducerContext, npc_id: u64, player_identity_for_response: Identity, message: String) -> Result<(), String> {
    // player_identity_for_response is the player the NPC is responding to.
    // ctx.sender is the identity that called this reducer (which will be the player's client after Groq call)

    // Check if NPC exists
     if ctx.db.npc().filter_by_npc_id(npc_id).is_none() {
        return Err(format!("NPC with ID {} not found for response.", npc_id));
    }
    // Check if the target player for the response still exists
    if ctx.db.player().filter_by_identity(player_identity_for_response).is_none() {
         // Optionally, check logged_out_player table too, or just log an error/warning
         spacetimedb::log::warn!("Target player {} for NPC {} response not found or logged out.", player_identity_for_response, npc_id);
         // Depending on game logic, you might still want to log the NPC's side of the conversation
         // or simply return an error. For now, let's allow logging even if player is gone.
    }


    spacetimedb::log::info!("NPC {} says to Player {}: '{}'", npc_id, player_identity_for_response, message);

    ctx.db.player_npc_interaction_log().insert(PlayerNpcInteraction {
        interaction_id: 0, // auto_inc
        npc_id,
        player_identity: player_identity_for_response, // Log who the NPC was talking to
        speaker: "npc".to_string(),
        message,
        timestamp: ctx.timestamp,
    }).map_err(|e| format!("Failed to log NPC response: {}", e))?;

    Ok(())
}

