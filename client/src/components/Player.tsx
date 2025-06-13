/**
 * Player.tsx
 *
 * Component responsible for rendering and controlling individual player entities:
 *
 * Key functionality:
 * - Handles 3D character model rendering with appropriate animations
 * - Implements physics-based player movement and collision detection
 * - Manages player state synchronization in multiplayer environment
 * - Processes user input for character control (keyboard/mouse)
 * - Handles different player classes with unique visual appearances
 * - Distinguishes between local player (user-controlled) and remote players
 *
 * Props:
 * - playerClass: Determines visual appearance and possibly abilities
 * - username: Unique identifier displayed above character
 * - position: Initial spawn coordinates
 * - color: Optional custom color for character
 * - isLocal: Boolean determining if this is the user-controlled player
 * - socketId: Unique network identifier for player synchronization
 * - onClick: Optional click handler for the player model (used for NPCs)
 *
 * Technical implementation:
 * - Uses React Three Fiber for 3D rendering within React
 * - Implements Rapier physics for movement and collision
 * - Manages socket.io communication for multiplayer state sync
 * - Handles animation state management for character model
 *
 * Related files:
 * - GameScene.tsx: Parent component that instantiates players
 * - PlayerUI.tsx: UI overlay for player status information
 * - Server socket handlers: For network state synchronization
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAnimations, Html, Sphere } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { PlayerData, InputState } from '../generated';

// Define animation names for reuse
const ANIMATIONS = {
  IDLE: 'idle',
  WALK_FORWARD: 'walk-forward',
  WALK_BACK: 'walk-back',
  WALK_LEFT: 'walk-left',
  WALK_RIGHT: 'walk-right',
  RUN_FORWARD: 'run-forward',
  RUN_BACK: 'run-back',
  RUN_LEFT: 'run-left',
  RUN_RIGHT: 'run-right',
  JUMP: 'jump',
  ATTACK: 'attack1',
  CAST: 'cast',
  DAMAGE: 'damage',
  DEATH: 'death',
};

// --- Client-side Constants ---
const PLAYER_SPEED = 5.0; // Match server logic
const SPRINT_MULTIPLIER = 1.8; // Match server logic

// --- Client-side Prediction Constants ---
const SERVER_TICK_RATE = 60; // Assuming server runs at 60Hz
const SERVER_TICK_DELTA = 1 / SERVER_TICK_RATE; // Use this for prediction
const POSITION_RECONCILE_THRESHOLD = 0.4;
const ROTATION_RECONCILE_THRESHOLD = 0.1; // Radians
const RECONCILE_LERP_FACTOR = 0.15;

// --- Camera Constants ---
const CAMERA_MODES = {
  FOLLOW: 'follow',  // Default camera following behind player
  ORBITAL: 'orbital' // Orbital camera that rotates around the player
};

interface PlayerProps {
  playerData: PlayerData;
  isLocalPlayer: boolean;
  onRotationChange?: (rotation: THREE.Euler) => void;
  currentInput?: InputState; // Prop to receive current input for local player
  isDebugArrowVisible?: boolean; // Prop to control debug arrow visibility
  isDebugPanelVisible?: boolean; // Prop to control general debug helpers visibility
  onClick?: () => void; // Added onClick prop for NPC interaction
}

export const Player: React.FC<PlayerProps> = ({
  playerData,
  isLocalPlayer,
  onRotationChange,
  currentInput, // Receive input state
  isDebugArrowVisible = false, 
  isDebugPanelVisible = false, // Destructure with default false
  onClick, // Destructure onClick
}) => {
  const group = useRef<THREE.Group>(null!);
  const { camera } = useThree();
  const dataRef = useRef<PlayerData>(playerData);
  const characterClass = playerData.characterClass || 'Wizard';
  
  // Model management
  const [modelLoaded, setModelLoaded] = useState(false);
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
  const [animations, setAnimations] = useState<Record<string, THREE.AnimationAction>>({});
  const [currentAnimation, setCurrentAnimation] = useState<string>(ANIMATIONS.IDLE);
  
  // --- Client Prediction State ---
  const localPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z));
  const localRotationRef = useRef<THREE.Euler>(new THREE.Euler(0, 0, 0, 'YXZ')); // Initialize with zero rotation
  const debugArrowRef = useRef<THREE.ArrowHelper | null>(null); // Declare the ref for the debug arrow
  
  // Camera control variables
  const isPointerLocked = useRef(false);
  const zoomLevel = useRef(5);
  const targetZoom = useRef(5);
  
  // Orbital camera variables
  const [cameraMode, setCameraMode] = useState<string>(CAMERA_MODES.FOLLOW);
  const orbitalCameraRef = useRef({
    distance: 8,
    height: 3,
    angle: 0,
    elevation: Math.PI / 6, // Approximately 30 degrees
    autoRotate: false,
    autoRotateSpeed: 0.5,
    lastUpdateTime: Date.now(),
    playerFacingRotation: 0 // Store player's facing direction when entering orbital mode
  });
  
  // Ref to track if animations have been loaded already to prevent multiple loading attempts
  const animationsLoadedRef = useRef(false);
  
  // Main character model path
  const mainModelPath = characterClass === 'Paladin' 
    ? '/models/paladin/paladin.fbx'
    : '/models/wizard/wizard.fbx';

  // --- State variables ---
  const pointLightRef = useRef<THREE.PointLight>(null!); // Ref for the declarative light

  // --- Client-Side Movement Calculation (Matches Server Logic *before* Sign Flip) ---
  const calculateClientMovement = useCallback((currentPos: THREE.Vector3, currentRot: THREE.Euler, inputState: InputState, delta: number): THREE.Vector3 => {
    if (!inputState.forward && !inputState.backward && !inputState.left && !inputState.right) {
      return currentPos;
    }
    let worldMoveVector = new THREE.Vector3();
    const speed = inputState.sprint ? PLAYER_SPEED * SPRINT_MULTIPLIER : PLAYER_SPEED;
    let rotationYaw = 0;
    let localMoveX = 0;
    let localMoveZ = 0;
    if (cameraMode === CAMERA_MODES.ORBITAL) {
        if (inputState.forward) localMoveZ += 1;
        if (inputState.backward) localMoveZ -= 1;
        if (inputState.left) localMoveX += 1;
        if (inputState.right) localMoveX -= 1;
    } else {
        if (inputState.forward) localMoveZ -= 1;
        if (inputState.backward) localMoveZ += 1;
        if (inputState.left) localMoveX -= 1;
        if (inputState.right) localMoveX += 1;
    }
    const localMoveVector = new THREE.Vector3(localMoveX, 0, localMoveZ);
    if (localMoveVector.lengthSq() > 1.1) localMoveVector.normalize();
    if (cameraMode === CAMERA_MODES.FOLLOW) rotationYaw = currentRot.y;
    else rotationYaw = orbitalCameraRef.current.playerFacingRotation;
    worldMoveVector = localMoveVector.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationYaw);
    worldMoveVector.multiplyScalar(speed * delta);
    const finalPosition = currentPos.clone().add(worldMoveVector);
    return finalPosition;
  }, [cameraMode]);

  // --- Effect for model loading ---
  useEffect(() => {
    if (!playerData) return;
    const loader = new FBXLoader();
    loader.load(
      mainModelPath,
      (fbx) => {
        if (characterClass === 'Paladin') fbx.scale.setScalar(1.0);
        else fbx.scale.setScalar(0.02);
        fbx.position.set(0, 0, 0);
        setModel(fbx); 
        if (group.current) {
          group.current.add(fbx);
          fbx.position.y = -0.1;
          try { 
            fbx.traverse((child) => {
              if (child && child instanceof THREE.Light) child.removeFromParent();
            });
          } catch (traverseError) {
             console.error(`[Player Model Effect ${playerData.username}] Error during fbx.traverse for light removal:`, traverseError);
          }
        } 
        const newMixer = new THREE.AnimationMixer(fbx);
        setMixer(newMixer);
        setModelLoaded(true);
        if (isLocalPlayer) {
          localPositionRef.current.set(playerData.position.x, playerData.position.y, playerData.position.z);
          localRotationRef.current.set(0, playerData.rotation.y, 0, 'YXZ');
        }
      },
      undefined,
      (error: any) => console.error(`[Player Model Effect ${playerData.username}] Error loading model ${mainModelPath}:`, error)
    );
    return () => {
      if (mixer) mixer.stopAllAction();
      if (model && group.current) group.current.remove(model);
      setModel(null); setMixer(null); setModelLoaded(false); animationsLoadedRef.current = false;
    };
  }, [mainModelPath, characterClass, playerData.username, isLocalPlayer, playerData.position.x, playerData.position.y, playerData.position.z, playerData.rotation.y]);

  useEffect(() => {
    if (mixer && model && !animationsLoadedRef.current) {
      animationsLoadedRef.current = true;
      loadAnimations(mixer);
    }
  }, [mixer, model, characterClass]); // Removed loadAnimations from deps as it's stable

  const loadAnimations = useCallback((mixerInstance: THREE.AnimationMixer) => {
    if (!mixerInstance) return;
    const animationPaths: Record<string, string> = {};
    const basePath = characterClass === 'Paladin' ? '/models/paladin/' : '/models/wizard/';
    const animKeys = {
      idle: characterClass === 'Wizard' ? 'wizard-standing-idle.fbx' : 'paladin-idle.fbx',
      'walk-forward': characterClass === 'Wizard' ? 'wizard-standing-walk-forward.fbx' : 'paladin-walk-forward.fbx',
      'walk-back': characterClass === 'Wizard' ? 'wizard-standing-walk-back.fbx' : 'paladin-walk-back.fbx',
      'walk-left': characterClass === 'Wizard' ? 'wizard-standing-walk-left.fbx' : 'paladin-walk-left.fbx',
      'walk-right': characterClass === 'Wizard' ? 'wizard-standing-walk-right.fbx' : 'paladin-walk-right.fbx',
      'run-forward': characterClass === 'Wizard' ? 'wizard-standing-run-forward.fbx' : 'paladin-run-forward.fbx',
      'run-back': characterClass === 'Wizard' ? 'wizard-standing-run-back.fbx' : 'paladin-run-back.fbx',
      'run-left': characterClass === 'Wizard' ? 'wizard-standing-run-left.fbx' : 'paladin-run-left.fbx',
      'run-right': characterClass === 'Wizard' ? 'wizard-standing-run-right.fbx' : 'paladin-run-right.fbx',
      jump: characterClass === 'Wizard' ? 'wizard-standing-jump.fbx' : 'paladin-jump.fbx',
      attack1: characterClass === 'Wizard' ? 'wizard-standing-1h-magic-attack-01.fbx' : 'paladin-attack.fbx',
      cast: characterClass === 'Wizard' ? 'wizard-standing-2h-magic-area-attack-02.fbx' : 'paladin-cast.fbx',
      damage: characterClass === 'Wizard' ? 'wizard-standing-react-small-from-front.fbx' : 'paladin-damage.fbx',
      death: characterClass === 'Wizard' ? 'wizard-standing-react-death-backward.fbx' : 'paladin-death.fbx',
    };
    Object.entries(animKeys).forEach(([key, filename]) => animationPaths[key] = `${basePath}${filename}`);
    const loader = new FBXLoader();
    const newAnimations: Record<string, THREE.AnimationAction> = {};
    let loadedCount = 0;
    const totalCount = Object.keys(animationPaths).length;
    const checkCompletedLoading = () => {
      loadedCount++;
      if (loadedCount === totalCount) {
        setAnimations(newAnimations);
        if (newAnimations['idle']) {
          setTimeout(() => {
             if (animationsLoadedRef.current && newAnimations['idle']) {
                 const idleAction = newAnimations['idle'];
                 idleAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.3).play();
                 setCurrentAnimation('idle');
             }
          }, 100); 
        } else console.error('Idle animation not found!');
      }
    };
    const loadAnimationFile = (name: string, path: string, mixerInstance: THREE.AnimationMixer) => {
      if (!mixerInstance) { checkCompletedLoading(); return; }
      loader.load(path, (animFbx) => {
          try {
            if (!animFbx.animations || animFbx.animations.length === 0) { checkCompletedLoading(); return; }
            const clip = animFbx.animations[0]; clip.name = name;
            const retargetedClip = retargetClip(clip, path);
            makeAnimationInPlace(retargetedClip);
            const action = mixerInstance.clipAction(retargetedClip);
            newAnimations[name] = action;
            if (name === 'idle' || name.startsWith('walk-') || name.startsWith('run-')) action.setLoop(THREE.LoopRepeat, Infinity);
            else { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
          } catch (e) { console.error(`Error processing animation ${name}:`, e); }
          checkCompletedLoading();
        }, undefined, (error: any) => { console.error(`Error loading animation ${name} from ${path}: ${error.message || 'Unknown error'}`); checkCompletedLoading(); }
      );
    };
    Object.entries(animationPaths).forEach(([name, path]) => {
      fetch(path).then(response => {
          if (!response.ok) { console.error(`Animation file not found: ${path}`); checkCompletedLoading(); return; }
          loadAnimationFile(name, path, mixerInstance);
        }).catch(error => { console.error(`Network error checking animation file ${path}:`, error); checkCompletedLoading(); });
    });
  }, [characterClass, mainModelPath]); // Added mainModelPath dependency

  const makeAnimationInPlace = (clip: THREE.AnimationClip) => {
    const tracks = clip.tracks;
    const positionTracks = tracks.filter(track => track.name.endsWith('.position'));
    if (positionTracks.length === 0) return;
    let rootTrack: THREE.KeyframeTrack | undefined;
    const rootNames = ['Hips.position', 'mixamorigHips.position', 'root.position', 'Armature.position', 'Root.position'];
    rootTrack = positionTracks.find(track => rootNames.some(name => track.name.toLowerCase().includes(name.toLowerCase())));
    if (!rootTrack) rootTrack = positionTracks[0];
    const rootTrackNameBase = rootTrack.name.split('.')[0];
    clip.tracks = tracks.filter(track => !track.name.startsWith(`${rootTrackNameBase}.position`));
  };

  const retargetClip = (clip: THREE.AnimationClip, sourceModelPath: string) => {
    if (!model) return clip;
    const sourceFileName = sourceModelPath.split('/').pop()?.split('.')[0] || '';
    const targetFileName = mainModelPath.split('/').pop()?.split('.')[0] || '';
    if (sourceFileName === targetFileName) return clip;
    const newTracks: THREE.KeyframeTrack[] = [];
    clip.tracks.forEach(track => {
      const trackNameParts = track.name.split('.');
      if (trackNameParts.length < 2) { newTracks.push(track); return; }
      const boneName = trackNameParts[0]; const property = trackNameParts.slice(1).join('.');
      let targetBoneName = boneName;
      const newTrackName = `${targetBoneName}.${property}`;
      if (newTrackName !== track.name) {
        let newTrack: THREE.KeyframeTrack;
        if (track instanceof THREE.QuaternionKeyframeTrack) newTrack = new THREE.QuaternionKeyframeTrack(newTrackName, Array.from(track.times), Array.from(track.values));
        else if (track instanceof THREE.VectorKeyframeTrack) newTrack = new THREE.VectorKeyframeTrack(newTrackName, Array.from(track.times), Array.from(track.values));
        else newTrack = new THREE.KeyframeTrack(newTrackName, Array.from(track.times), Array.from(track.values));
        newTracks.push(newTrack);
      } else newTracks.push(track);
    });
    return new THREE.AnimationClip(clip.name, clip.duration, newTracks, clip.blendMode);
  };

  const playAnimation = useCallback((name: string, crossfadeDuration = 0.3) => {
    if (!mixer || !animations[name]) {
      if (name !== ANIMATIONS.IDLE && animations[ANIMATIONS.IDLE]) name = ANIMATIONS.IDLE;
      else return;
    }
    const targetAction = animations[name];
    const currentAction = animations[currentAnimation];
    if (currentAction && currentAction !== targetAction) currentAction.fadeOut(crossfadeDuration);
    targetAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(crossfadeDuration).play();
    setCurrentAnimation(name);
  }, [animations, currentAnimation, mixer]);

  useEffect(() => {
    if (model && group.current) {
      group.current.traverse((child) => {
        if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
      });
    }
  }, [model]);

  useEffect(() => {
    if (!isLocalPlayer) return;
    const handlePointerLockChange = () => {
      isPointerLocked.current = document.pointerLockElement === document.body;
      if (isPointerLocked.current) document.body.classList.add('cursor-locked');
      else document.body.classList.remove('cursor-locked');
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!isPointerLocked.current || !isLocalPlayer) return;
      if (cameraMode === CAMERA_MODES.FOLLOW) {
        const sensitivity = 0.003;
        localRotationRef.current.y -= e.movementX * sensitivity;
        localRotationRef.current.y = THREE.MathUtils.euclideanModulo(localRotationRef.current.y + Math.PI, 2 * Math.PI) - Math.PI;
        if (onRotationChange) onRotationChange(localRotationRef.current);
      } else if (cameraMode === CAMERA_MODES.ORBITAL) {
        const orbital = orbitalCameraRef.current; const sensitivity = 0.005;
        orbital.angle -= e.movementX * sensitivity;
        orbital.elevation += e.movementY * sensitivity;
        orbital.elevation = Math.max(Math.PI / 12, Math.min(Math.PI / 2.1, orbital.elevation));
      }
    };
    const handleMouseWheel = (e: WheelEvent) => {
      if (!isLocalPlayer) return;
      if (cameraMode === CAMERA_MODES.FOLLOW) {
        const zoomSpeed = 0.8; const zoomChange = Math.sign(e.deltaY) * zoomSpeed;
        targetZoom.current = Math.max(2.0, Math.min(12.0, zoomLevel.current + zoomChange));
      } else if (cameraMode === CAMERA_MODES.ORBITAL) {
        const orbital = orbitalCameraRef.current; const zoomSpeed = 0.5; const zoomChange = Math.sign(e.deltaY) * zoomSpeed;
        orbital.distance = Math.max(3, Math.min(20, orbital.distance + zoomChange));
      }
    };
    const handleCanvasClick = () => { if (!isPointerLocked.current) document.body.requestPointerLock(); };
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('wheel', handleMouseWheel);
    document.addEventListener('click', handleCanvasClick);
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('wheel', handleMouseWheel);
      document.removeEventListener('click', handleCanvasClick);
    };
  }, [isLocalPlayer, onRotationChange, cameraMode]);

  useEffect(() => {
    if (mixer && animations[currentAnimation] && (currentAnimation === ANIMATIONS.JUMP || currentAnimation === ANIMATIONS.ATTACK || currentAnimation === ANIMATIONS.CAST)) {
      const action = animations[currentAnimation];
      if (!action || !action.getClip()) return;
      const onFinished = (event: any) => {
        if (event.action === action) {
           playAnimation(ANIMATIONS.IDLE, 0.1);
           mixer.removeEventListener('finished', onFinished);
        }
      };
      mixer.addEventListener('finished', onFinished);
      return () => { if (mixer) mixer.removeEventListener('finished', onFinished); };
    }
  }, [currentAnimation, animations, mixer, playAnimation]);

  const toggleCameraMode = useCallback(() => {
    const newMode = cameraMode === CAMERA_MODES.FOLLOW ? CAMERA_MODES.ORBITAL : CAMERA_MODES.FOLLOW;
    setCameraMode(newMode);
    if (newMode === CAMERA_MODES.ORBITAL) {
      orbitalCameraRef.current.playerFacingRotation = localRotationRef.current.y;
      orbitalCameraRef.current.angle = localRotationRef.current.y;
      orbitalCameraRef.current.elevation = Math.PI / 6; 
    }
  }, [cameraMode]);

  useEffect(() => {
    if (!isLocalPlayer) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.code === 'KeyC' && !event.repeat) toggleCameraMode(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocalPlayer, toggleCameraMode]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    if (isLocalPlayer) dataRef.current = playerData;
    if (group.current && modelLoaded) {
      if (isLocalPlayer && currentInput) {
        const predictedPosition = calculateClientMovement(localPositionRef.current, localRotationRef.current, currentInput, SERVER_TICK_DELTA);
        localPositionRef.current.copy(predictedPosition);
        const serverPosition = new THREE.Vector3(dataRef.current.position.x, dataRef.current.position.y, dataRef.current.position.z);
        const unflippedServerPosition = serverPosition.clone();
        unflippedServerPosition.x *= -1; unflippedServerPosition.z *= -1;
        const positionError = localPositionRef.current.distanceTo(unflippedServerPosition);
        if (positionError > POSITION_RECONCILE_THRESHOLD && cameraMode !== CAMERA_MODES.ORBITAL) {
            localPositionRef.current.lerp(serverPosition, RECONCILE_LERP_FACTOR);
        }
        const serverRotation = new THREE.Euler(0, dataRef.current.rotation.y, 0, 'YXZ');
        const reconcileTargetQuat = new THREE.Quaternion().setFromEuler(serverRotation);
        const currentQuat = new THREE.Quaternion().setFromEuler(localRotationRef.current);
        const rotationError = currentQuat.angleTo(reconcileTargetQuat);
        if (rotationError > ROTATION_RECONCILE_THRESHOLD) {
            currentQuat.slerp(reconcileTargetQuat, RECONCILE_LERP_FACTOR);
            localRotationRef.current.setFromQuaternion(currentQuat, 'YXZ');
        }
        group.current.position.copy(localPositionRef.current);
        let targetVisualYaw = localRotationRef.current.y;
        if (cameraMode === CAMERA_MODES.FOLLOW) {
            const { forward, backward, left, right } = currentInput;
            if ((forward || backward) && (left || right)) {
                let localMoveX = 0; let localMoveZ = 0;
                if (forward) localMoveZ -= 1; if (backward) localMoveZ += 1;
                if (left) localMoveX -= 1; if (right) localMoveX += 1;
                const localMoveVector = new THREE.Vector3(localMoveX, 0, localMoveZ).normalize(); 
                const worldMoveDirection = localMoveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), localRotationRef.current.y);
                targetVisualYaw = Math.atan2(worldMoveDirection.x, worldMoveDirection.z);
                if (forward && !backward) targetVisualYaw += Math.PI;
            }
        } else {
            const { forward, backward, left, right } = currentInput;
            if ((forward || backward) && (left || right)) {
                let localMoveX = 0; let localMoveZ = 0;
                if (forward) localMoveZ += 1; if (backward) localMoveZ -= 1;
                if (left) localMoveX += 1; if (right) localMoveX -= 1;
                const localMoveVector = new THREE.Vector3(localMoveX, 0, localMoveZ).normalize();
                const worldMoveDirection = localMoveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), orbitalCameraRef.current.playerFacingRotation);
                targetVisualYaw = Math.atan2(worldMoveDirection.x, worldMoveDirection.z);
                if (!forward && backward) targetVisualYaw += Math.PI;
            } else targetVisualYaw = orbitalCameraRef.current.playerFacingRotation;
        }
        const targetVisualRotation = new THREE.Euler(0, targetVisualYaw, 0, 'YXZ');
        const targetVisualQuat = new THREE.Quaternion().setFromEuler(targetVisualRotation);
        group.current.quaternion.slerp(targetVisualQuat, Math.min(1, dt * 10)); 
        const scene = group.current?.parent;
        if (isDebugArrowVisible && scene) {
          const playerWorldPos = group.current.position;
          const playerWorldRotY = group.current.rotation.y; 
          const forwardDirection = new THREE.Vector3(Math.sin(playerWorldRotY), 0, Math.cos(playerWorldRotY)).normalize();
          if (debugArrowRef.current) {
            debugArrowRef.current.position.copy(playerWorldPos).add(new THREE.Vector3(0, 0.5, 0));
            debugArrowRef.current.setDirection(forwardDirection); debugArrowRef.current.visible = true; 
          } else {
            debugArrowRef.current = new THREE.ArrowHelper(forwardDirection, playerWorldPos.clone().add(new THREE.Vector3(0, 0.5, 0)), 3, 0xff0000);
            scene.add(debugArrowRef.current);
          }
        } else if (debugArrowRef.current && debugArrowRef.current.parent) {
           debugArrowRef.current.parent.remove(debugArrowRef.current); debugArrowRef.current = null;
        }
      } else {
        if (debugArrowRef.current && debugArrowRef.current.parent) {
           debugArrowRef.current.parent.remove(debugArrowRef.current); debugArrowRef.current = null;
        }
        const serverPosition = new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z);
        const targetRotation = new THREE.Euler(0, playerData.rotation.y, 0, 'YXZ');
        group.current.position.lerp(serverPosition, Math.min(1, dt * 10));
        group.current.quaternion.slerp(new THREE.Quaternion().setFromEuler(targetRotation), Math.min(1, dt * 8));
      }
    }
    if (isLocalPlayer && group.current) {
      if (cameraMode === CAMERA_MODES.FOLLOW) zoomLevel.current += (targetZoom.current - zoomLevel.current) * Math.min(1, dt * 6);
      const playerPosition = localPositionRef.current; 
      const playerRotationY = localRotationRef.current.y; 
      if (cameraMode === CAMERA_MODES.FOLLOW) {
        const targetPosition = new THREE.Vector3(
          playerPosition.x - Math.sin(playerRotationY) * zoomLevel.current,
          playerPosition.y + 2.5,
          playerPosition.z - Math.cos(playerRotationY) * zoomLevel.current 
        );
        camera.position.lerp(targetPosition, Math.min(1, dt * 12));
        camera.lookAt(playerPosition.clone().add(new THREE.Vector3(0, 1.8, 0)));
      } else if (cameraMode === CAMERA_MODES.ORBITAL) {
        const orbital = orbitalCameraRef.current;
        const horizontalDistance = orbital.distance * Math.cos(orbital.elevation);
        const height = orbital.distance * Math.sin(orbital.elevation);
        const targetPosition = new THREE.Vector3(playerPosition.x + Math.sin(orbital.angle) * horizontalDistance, playerPosition.y + height, playerPosition.z + Math.cos(orbital.angle) * horizontalDistance);
        camera.position.lerp(targetPosition, Math.min(1, dt * 8));
        camera.lookAt(playerPosition.clone().add(new THREE.Vector3(0, 1.5, 0))); 
      }
    }
    if (mixer) mixer.update(dt);
  });

  useEffect(() => {
    if (!mixer || Object.keys(animations).length === 0) return;
    const serverAnim = playerData.currentAnimation;
    if (serverAnim && serverAnim !== currentAnimation && animations[serverAnim]) {
      try { playAnimation(serverAnim, 0.2); }
      catch (error) {
        console.error(`[Anim Error] Error playing animation ${serverAnim}:`, error);
        if (animations['idle'] && currentAnimation !== 'idle') playAnimation('idle', 0.2);
      }
    }
  }, [playerData.currentAnimation, animations, mixer, playAnimation, currentAnimation]);

  return (
    // Add onClick handler to the group. This will be used for NPC interactions.
    <group ref={group} castShadow onClick={onClick}>
      <pointLight 
        ref={pointLightRef} 
        position={[0, -0.5, 0]}
        color={0xffccaa} 
        intensity={2.5}
        distance={5} 
        decay={2} 
        castShadow={false} 
      />
      <Sphere args={[0.1, 16, 16]} position={[0, -0.5, 0]} visible={isDebugPanelVisible}>
        <meshBasicMaterial color="red" wireframe /> 
      </Sphere>
      {model && (
        <Html position={[0, 2.5, 0]} center distanceFactor={10}>
            <div className="nametag">
            <div className="nametag-text">{playerData.username}</div>
            <div className="nametag-class">{characterClass}</div>
            </div>
        </Html>
      )}
    </group>
  );
};