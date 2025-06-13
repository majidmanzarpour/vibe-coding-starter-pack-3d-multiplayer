/**
 * GameScene.tsx
 *
 * Core component that manages the 3D multiplayer game environment:
 *
 * Key functionality:
 * - Acts as the primary container for all 3D game elements
 * - Manages the game world environment (terrain, lighting, physics)
 * - Instantiates and coordinates player and NPC entities
 * - Handles multiplayer synchronization across clients
 * - Manages game state and lifecycle (start, join, disconnect)
 * - Maintains socket connections for real-time gameplay
 *
 * Props:
 * - username: The local player's display name
 * - playerClass: The selected character class for the local player
 * - roomId: Unique identifier for the multiplayer game session
 * - onDisconnect: Callback function when player disconnects from game
 */

import React, { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Plane, Grid, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { DirectionalLightHelper, CameraHelper } from 'three';
// Import generated types
import { PlayerData, NpcData, InputState } from '../generated'; 
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { Player } from './Player';

interface GameSceneProps {
  players: ReadonlyMap<string, PlayerData>;
  npcs: ReadonlyMap<string, NpcData>;
  localPlayerIdentity: Identity | null;
  onPlayerRotation?: (rotation: THREE.Euler) => void;
  currentInputRef?: React.MutableRefObject<InputState>;
  isDebugPanelVisible?: boolean;
  onNpcClick?: (npc: NpcData) => void; // Added onNpcClick prop
}

export const GameScene: React.FC<GameSceneProps> = ({ 
  players, 
  npcs, 
  localPlayerIdentity,
  onPlayerRotation,
  currentInputRef,
  isDebugPanelVisible = false,
  onNpcClick, // Destructure onNpcClick
}) => {
  const directionalLightRef = useRef<THREE.DirectionalLight>(null!); 

  const defaultNpcInput: InputState = {
    forward: false, backward: false, left: false, right: false,
    sprint: false, jump: false, attack: false, castSpell: false,
    sequence: 0,
  };

  return (
    <Canvas 
      camera={{ position: [0, 10, 20], fov: 60 }} 
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }} 
      shadows
    >
      <Sky distance={450000} sunPosition={[5, 1, 8]} inclination={0} azimuth={0.25} />
      <ambientLight intensity={0.5} />
      <directionalLight 
        ref={directionalLightRef}
        position={[15, 20, 10]} 
        intensity={2.5} 
        castShadow 
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0001}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={0.1}
        shadow-camera-far={100}
      />
      {isDebugPanelVisible && directionalLightRef.current && (
        <>
          <primitive object={new DirectionalLightHelper(directionalLightRef.current, 5)} />
          <primitive object={new CameraHelper(directionalLightRef.current.shadow.camera)} /> 
        </>
      )}
      <Plane 
        args={[200, 200]} 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, -0.001, 0]} 
        receiveShadow={true} 
      >
        <meshStandardMaterial color="#606060" />
      </Plane>
      <Grid 
        position={[0, 0, 0]} 
        args={[200, 200]} 
        cellSize={2} 
        cellThickness={1}
        cellColor={new THREE.Color('#888888')}
      />

      {/* Render Players */}
      {Array.from(players.values()).map((player) => {
        const isLocal = localPlayerIdentity?.toHexString() === player.identity.toHexString();
        return (
          <Player 
            key={player.identity.toHexString()} 
            playerData={player}
            isLocalPlayer={isLocal}
            onRotationChange={isLocal ? onPlayerRotation : undefined}
            currentInput={isLocal ? currentInputRef?.current : undefined}
            isDebugArrowVisible={isLocal ? isDebugPanelVisible : false}
            isDebugPanelVisible={isDebugPanelVisible}
          />
        );
      })}

      {/* Render NPCs */}
      {Array.from(npcs.values()).map((npc) => {
        const npcAsPlayerData: PlayerData = {
          identity: Identity.from(npc.npc_id), 
          username: npc.name,
          character_class: npc.model_name, 
          position: npc.position,
          rotation: { x: 0, y: 0, z: 0 }, 
          health: 100, 
          max_health: 100, 
          mana: 0, 
          max_mana: 0, 
          current_animation: "idle", 
          is_moving: false,
          is_running: false,
          is_attacking: false,
          is_casting: false,
          last_input_seq: 0,
          input: defaultNpcInput,
          color: "grey", 
        };
        return (
          <Player 
            key={`npc-${npc.npc_id.toString()}`}
            playerData={npcAsPlayerData} // Using adapted data
            isLocalPlayer={false}
            isDebugPanelVisible={isDebugPanelVisible}
            // Pass the onNpcClick handler for NPCs
            // This will be triggered when the Player component (representing the NPC) is clicked
            onClick={onNpcClick ? () => onNpcClick(npc) : undefined}
          />
        );
      })}
    </Canvas>
  );
};
