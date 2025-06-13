/**
 * Vibe Coding Starter Pack: 3D Multiplayer - App.tsx
 *
 * Main application component that orchestrates the entire multiplayer experience.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import './App.css';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import * as moduleBindings from './generated'; 
import { DebugPanel } from './components/DebugPanel';
import { GameScene } from './components/GameScene';
import { JoinGameDialog } from './components/JoinGameDialog';
import * as THREE from 'three';
import { PlayerUI } from './components/PlayerUI';
import { NpcInteractionDialog } from './components/NpcInteractionDialog'; // Added NPC Interaction Dialog

// Type Aliases
type DbConnection = moduleBindings.DbConnection;
type EventContext = moduleBindings.EventContext;
type ErrorContext = moduleBindings.ErrorContext;
type PlayerData = moduleBindings.PlayerData;
type NpcData = moduleBindings.NpcData;
type PlayerNpcInteraction = moduleBindings.PlayerNpcInteraction; // Added interaction log type
type InputState = moduleBindings.InputState;

let conn: DbConnection | null = null;

// Placeholder for Groq API call
async function getGroqChatCompletion(npcGreeting: string, conversationHistory: PlayerNpcInteraction[], playerMessage: string): Promise<string> {
  console.log("[Groq Placeholder] NPC Greeting:", npcGreeting);
  console.log("[Groq Placeholder] Conversation History:", conversationHistory.map(log => `${log.speaker}: ${log.message}` ).join('\n'));
  console.log("[Groq Placeholder] Player Message:", playerMessage);
  
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Simple canned response for now
  const responses = [
    "Interesting point. Tell me more.",
    "I see. And what do you make of that?",
    "That is a perspective I hadn't considered.",
    "Hmm, let me ponder on that.",
    "Are you sure about that?"
  ];
  const randomResponse = responses[Math.floor(Math.random() * responses.length)];
  console.log("[Groq Placeholder] NPC Response:", randomResponse);
  return randomResponse;
}

function App() {
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [statusMessage, setStatusMessage] = useState("Connecting...");
  const [players, setPlayers] = useState<ReadonlyMap<string, PlayerData>>(new Map());
  const [npcs, setNpcs] = useState<ReadonlyMap<string, NpcData>>(new Map());
  const [localPlayer, setLocalPlayer] = useState<PlayerData | null>(null);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [isDebugPanelExpanded, setIsDebugPanelExpanded] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  // NPC Interaction State
  const [selectedNpcForDialogue, setSelectedNpcForDialogue] = useState<NpcData | null>(null);
  const [currentConversationLog, setCurrentConversationLog] = useState<PlayerNpcInteraction[]>([]);
  const allInteractionsRef = useRef<Map<string, PlayerNpcInteraction>>(new Map()); // To store all interactions from the table

  const currentInputRef = useRef<InputState>({
    forward: false, backward: false, left: false, right: false,
    sprint: false, jump: false, attack: false, castSpell: false,
    sequence: 0,
  });
  const lastSentInputState = useRef<Partial<InputState>>({});
  const animationFrameIdRef = useRef<number | null>(null);
  const playerRotationRef = useRef<THREE.Euler>(new THREE.Euler(0, 0, 0, 'YXZ'));

  const registerTableCallbacks = useCallback(() => {
    if (!conn) return;
    console.log("Registering table callbacks...");

    conn.db.player.onInsert((_ctx: EventContext, player: PlayerData) => {
        setPlayers((prev) => new Map(prev).set(player.identity.toHexString(), player));
        if (identity && player.identity.toHexString() === identity.toHexString()) {
            setLocalPlayer(player);
            setStatusMessage(`Registered as ${player.username}`);
        }
    });
    conn.db.player.onUpdate((_ctx: EventContext, _oldPlayer: PlayerData, newPlayer: PlayerData) => {
        setPlayers((prev) => new Map(prev).set(newPlayer.identity.toHexString(), newPlayer));
        if (identity && newPlayer.identity.toHexString() === identity.toHexString()) setLocalPlayer(newPlayer);
    });
    conn.db.player.onDelete((_ctx: EventContext, player: PlayerData) => {
        setPlayers((prev) => { const newMap = new Map(prev); newMap.delete(player.identity.toHexString()); return newMap; });
        if (identity && player.identity.toHexString() === identity.toHexString()) setLocalPlayer(null);
    });

    conn.db.npc.onInsert((_ctx: EventContext, npc: NpcData) => {
        setNpcs((prev) => new Map(prev).set(npc.npc_id.toString(), npc));
    });
    conn.db.npc.onUpdate((_ctx: EventContext, _oldNpc: NpcData, newNpc: NpcData) => {
        setNpcs((prev) => new Map(prev).set(newNpc.npc_id.toString(), newNpc));
    });
    conn.db.npc.onDelete((_ctx: EventContext, npc: NpcData) => {
        setNpcs((prev) => { const newMap = new Map(prev); newMap.delete(npc.npc_id.toString()); return newMap; });
    });

    // PlayerNpcInteractionLog callbacks
    conn.db.player_npc_interaction_log.onInsert((_ctx: EventContext, interaction: PlayerNpcInteraction) => {
      console.log("Interaction Inserted:", interaction);
      allInteractionsRef.current.set(interaction.interaction_id.toString(), interaction);
      if (selectedNpcForDialogue && interaction.npc_id === selectedNpcForDialogue.npc_id) {
        // Only update if it pertains to the currently selected NPC
         if (interaction.player_identity.toHexString() === identity?.toHexString() || interaction.speaker === "npc") {
            setCurrentConversationLog(prevLog => [...prevLog, interaction].sort((a,b) => Number(a.timestamp) - Number(b.timestamp)));
         }
      }
    });
    // onUpdate/onDelete for interaction log can be added if needed, but often interactions are append-only.

    console.log("Table callbacks registered.");
  }, [identity, selectedNpcForDialogue]);

  const onSubscriptionApplied = useCallback(() => {
     console.log("Subscription applied successfully.");
     if (!conn) return;
     setPlayers(() => {
         const currentPlayers = new Map<string, PlayerData>();
         for (const player of conn.db.player.iter()) {
             currentPlayers.set(player.identity.toHexString(), player);
             if (identity && player.identity.toHexString() === identity.toHexString()) setLocalPlayer(player);
         }
         return currentPlayers;
     });
     setNpcs(() => {
         const currentNpcs = new Map<string, NpcData>();
         for (const npc of conn.db.npc.iter()) currentNpcs.set(npc.npc_id.toString(), npc);
         return currentNpcs;
     });
     // Populate all interactions ref initially
    allInteractionsRef.current.clear();
    for (const interaction of conn.db.player_npc_interaction_log.iter()) {
        allInteractionsRef.current.set(interaction.interaction_id.toString(), interaction);
    }
    // If an NPC is already selected, filter its conversation log
    if (selectedNpcForDialogue) {
        const filteredLog = Array.from(allInteractionsRef.current.values())
            .filter(log => log.npc_id === selectedNpcForDialogue.npc_id && 
                           (log.player_identity.toHexString() === identity?.toHexString() || log.speaker === "npc"))
            .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        setCurrentConversationLog(filteredLog);
    }

  }, [identity, selectedNpcForDialogue]);

  const onSubscriptionError = useCallback((error: any) => {
      console.error("Subscription error:", error);
      setStatusMessage(`Subscription Error: ${error?.message || error}`);
  }, []);

  const subscribeToTables = useCallback(() => {
    if (!conn) return;
    console.log("Subscribing to tables...");
    const subscription = conn.subscriptionBuilder();
    subscription.subscribe("SELECT * FROM player");
    subscription.subscribe("SELECT * FROM npc");
    subscription.subscribe("SELECT * FROM player_npc_interaction_log"); // Added interaction log subscription
    subscription.onApplied(onSubscriptionApplied);
    subscription.onError(onSubscriptionError);
  }, [onSubscriptionApplied, onSubscriptionError]);

  const handleNpcClick = useCallback((npc: NpcData) => {
    if (!identity) return;
    console.log(`Interacting with NPC: ${npc.name} (ID: ${npc.npc_id})`);
    setSelectedNpcForDialogue(npc);
    // Filter conversation log for this NPC and current player
    const filteredLog = Array.from(allInteractionsRef.current.values())
        .filter(log => log.npc_id === npc.npc_id && 
                       (log.player_identity.toHexString() === identity.toHexString() || log.speaker === "npc"))
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    setCurrentConversationLog(filteredLog);
    // Optional: Request pointer lock release if needed for UI interaction
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
  }, [identity]);

  const handleCloseNpcDialog = useCallback(() => {
    setSelectedNpcForDialogue(null);
    setCurrentConversationLog([]);
  }, []);

  const handleSendMessageToNpc = useCallback(async (npcId: string | number, message: string) => {
    if (!conn || !identity || !selectedNpcForDialogue) return;
    const npcNumericId = typeof npcId === 'string' ? parseInt(npcId, 10) : npcId;

    console.log(`Sending message to NPC ${npcNumericId}: "${message}"`);
    try {
      // 1. Log player's message
      await conn.reducers.playerSpeaksToNpc(npcNumericId, message);
      console.log("Player message sent to server.");

      // 2. Get NPC response (e.g., from Groq)
      // Create a snapshot of the conversation log *before* adding the player's latest message for the LLM context
      const conversationForLLM = [...currentConversationLog];
      // Add the player's current message to the history for the LLM to respond to
      // It won't have a real timestamp or ID yet, but can be simulated for context
      const simulatedPlayerInteraction: PlayerNpcInteraction = {
          interaction_id: BigInt(0), // Placeholder
          npc_id: BigInt(npcNumericId),
          player_identity: identity, 
          speaker: "player",
          message: message,
          timestamp: BigInt(Math.floor(Date.now() / 1000))
      };

      const npcResponseText = await getGroqChatCompletion(
        selectedNpcForDialogue.dialogue_greeting,
        [...conversationForLLM, simulatedPlayerInteraction], // Pass current history + new player message
        message
      );

      // 3. Log NPC's response
      if (npcResponseText) {
        await conn.reducers.npcRespondsToPlayer(npcNumericId, identity, npcResponseText);
        console.log("NPC response sent to server.");
      }
    } catch (error) {
      console.error("Error sending message or getting NPC response:", error);
      // Optionally, update UI to show error to player
    }
  }, [conn, identity, selectedNpcForDialogue, currentConversationLog]);

  // --- Input & Game Loop (mostly unchanged) ---
  const handleDelegatedClick = useCallback((event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest('.interactive-button');
      if (button) {
          event.preventDefault();
          console.log(`[CLIENT] Button click detected: ${button.getAttribute('data-action')}`);
      }
  }, []);
  const keyMap: { [key: string]: keyof Omit<InputState, 'sequence' | 'castSpell'> } = {
      KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right',
      ShiftLeft: 'sprint', Space: 'jump',
  };
  const determineAnimation = useCallback((input: InputState): string => {
    if (input.attack) return 'attack1';
    if (input.castSpell) return 'cast';
    if (input.jump) return 'jump';
    const { forward, backward, left, right, sprint } = input;
    const isMoving = forward || backward || left || right;
    if (!isMoving) return 'idle';
    let direction = 'forward';
    if (forward && !backward) direction = 'forward';
    else if (backward && !forward) direction = 'back';
    else if (left && !right) direction = 'left';
    else if (right && !left) direction = 'right';
    else if (forward && left) direction = 'left';
    else if (forward && right) direction = 'right'; 
    else if (backward && left) direction = 'left';
    else if (backward && right) direction = 'right';
    const moveType = sprint ? 'run' : 'walk';
    return `${moveType}-${direction}`;
  }, []);
  const sendInput = useCallback((currentInputState: InputState) => {
    if (!conn || !identity || !connected || !localPlayer) return;
    const currentPosition = localPlayer.position;
    const currentRotation = { x: playerRotationRef.current.x, y: playerRotationRef.current.y, z: playerRotationRef.current.z };
    const currentAnimation = determineAnimation(currentInputState);
    let changed = false;
    for (const key in currentInputState) {
        if (currentInputState[key as keyof InputState] !== lastSentInputState.current[key as keyof InputState]) {
            changed = true; break;
        }
    }
    if (changed || currentInputState.sequence !== lastSentInputState.current.sequence) {
        conn.reducers.updatePlayerInput(currentInputState, currentPosition, currentRotation, currentAnimation);
        lastSentInputState.current = { ...currentInputState };
    }
  }, [identity, localPlayer, connected, determineAnimation]);
  const handlePlayerRotation = useCallback((rotation: THREE.Euler) => { playerRotationRef.current.copy(rotation); }, []);
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
      if (selectedNpcForDialogue) return; // Don't process game input if dialog is open
      if (event.repeat) return; 
      const action = keyMap[event.code];
      if (action) currentInputRef.current[action] = true;
  }, [selectedNpcForDialogue]);
  const handleKeyUp = useCallback((event: KeyboardEvent) => {
      if (selectedNpcForDialogue) return; // Don't process game input if dialog is open
      const action = keyMap[event.code];
      if (action) currentInputRef.current[action] = false;
  }, [selectedNpcForDialogue]);
  const handleMouseDown = useCallback((event: MouseEvent) => {
      // Allow mouse down for UI interaction even if dialog is open, but only process game attack if not
      if (!selectedNpcForDialogue && event.button === 0) currentInputRef.current.attack = true;
  }, [selectedNpcForDialogue]);
  const handleMouseUp = useCallback((event: MouseEvent) => {
      if (!selectedNpcForDialogue && event.button === 0) currentInputRef.current.attack = false;
  }, [selectedNpcForDialogue]);
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (document.pointerLockElement === document.body) {
      const sensitivity = 0.002;
      playerRotationRef.current.y -= event.movementX * sensitivity;
      playerRotationRef.current.x = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, playerRotationRef.current.x - event.movementY * sensitivity));
    }
  }, []);
  const handlePointerLockChange = useCallback(() => { setIsPointerLocked(document.pointerLockElement === document.body); }, []);
  const setupInputListeners = useCallback(() => {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('pointerlockchange', handlePointerLockChange);
  }, [handleKeyDown, handleKeyUp, handleMouseDown, handleMouseUp, handleMouseMove, handlePointerLockChange]);
  const removeInputListeners = useCallback(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, [handleKeyDown, handleKeyUp, handleMouseDown, handleMouseUp, handleMouseMove, handlePointerLockChange]);
  const setupDelegatedListeners = useCallback(() => { document.body.addEventListener('click', handleDelegatedClick, true); }, [handleDelegatedClick]);
  const removeDelegatedListeners = useCallback(() => { document.body.removeEventListener('click', handleDelegatedClick, true); }, [handleDelegatedClick]);

  useEffect(() => {
      const gameLoop = () => {
          if (!connected || !conn || !identity || selectedNpcForDialogue) { // Pause game loop if dialog is open
              if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
              animationFrameIdRef.current = null;
              return;
          }
          currentInputRef.current.sequence += 1;
          sendInput(currentInputRef.current);
          animationFrameIdRef.current = requestAnimationFrame(gameLoop);
      };
      if (connected && !selectedNpcForDialogue && !animationFrameIdRef.current) {
          animationFrameIdRef.current = requestAnimationFrame(gameLoop);
      }
      return () => { if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current); animationFrameIdRef.current = null; };
  }, [connected, conn, identity, sendInput, selectedNpcForDialogue]);

  useEffect(() => {
    if (conn) {
         if (connected) { setupInputListeners(); setupDelegatedListeners(); }
        return;
    }
    const dbHost = "localhost:3000";
    const dbName = "vibe-multiplayer";
    const onConnect = (connection: DbConnection, id: Identity, _token: string) => {
      conn = connection;
      setIdentity(id);
      setConnected(true);
      setStatusMessage(`Connected as ${id.toHexString().substring(0, 8)}...`);
      subscribeToTables();
      registerTableCallbacks();
      setupInputListeners();
      setupDelegatedListeners();
      setShowJoinDialog(true);
    };
    const onDisconnect = (_ctx: ErrorContext, reason?: Error | null) => {
      const reasonStr = reason ? reason.message : "No reason given";
      setStatusMessage(`Disconnected: ${reasonStr}`);
      conn = null; setIdentity(null); setConnected(false);
      setPlayers(new Map()); setNpcs(new Map()); setLocalPlayer(null);
      setSelectedNpcForDialogue(null); setCurrentConversationLog([]); // Clear dialogue state on disconnect
    };
    moduleBindings.DbConnection.builder().withUri(`ws://${dbHost}`).withModuleName(dbName).onConnect(onConnect).onDisconnect(onDisconnect).build();
    return () => { removeInputListeners(); removeDelegatedListeners(); };
  }, [connected, registerTableCallbacks, subscribeToTables, setupInputListeners, removeInputListeners, setupDelegatedListeners, removeDelegatedListeners]); // Added dependencies to connection effect

  const handleJoinGame = (username: string, characterClass: string) => {
    if (!conn) return;
    conn.reducers.registerPlayer(username, characterClass);
    setShowJoinDialog(false);
  };

  return (
    <div className="App" style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {showJoinDialog && <JoinGameDialog onJoin={handleJoinGame} />}
      {connected && (
          <DebugPanel statusMessage={statusMessage} localPlayer={localPlayer} identity={identity} playerMap={players} expanded={isDebugPanelExpanded} onToggleExpanded={() => setIsDebugPanelExpanded((prev) => !prev)} isPointerLocked={isPointerLocked} />
      )}
      {connected && (
        <>
          <GameScene 
            players={players} 
            npcs={npcs} 
            localPlayerIdentity={identity} 
            onPlayerRotation={handlePlayerRotation}
            currentInputRef={currentInputRef}
            isDebugPanelVisible={isDebugPanelExpanded}
            onNpcClick={handleNpcClick} // Pass the click handler to GameScene
          />
          {localPlayer && <PlayerUI playerData={localPlayer} />}
        </>
      )}
      {selectedNpcForDialogue && identity && (
        <NpcInteractionDialog 
          npc={selectedNpcForDialogue}
          conversation={currentConversationLog}
          onSendMessage={handleSendMessageToNpc}
          onClose={handleCloseNpcDialog}
          localPlayerIdentityHex={identity.toHexString()} // Pass local player identity hex
        />
      )}
      {!connected && (
          <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100%'}}><h1>{statusMessage}</h1></div>
      )}
    </div>
  );
}

export default App;
