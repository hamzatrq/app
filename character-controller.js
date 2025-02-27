/*
this file is responisible for maintaining player state that is network-replicated.
*/

import * as THREE from 'three';
import * as Z from 'zjs';
import {getRenderer, scene, camera, dolly} from './renderer.js';
import physicsManager from './physics-manager.js';
import {world} from './world.js';
import cameraManager from './camera-manager.js';
import physx from './physx.js';
import Avatar from './avatars/avatars.js';
import metaversefile from 'metaversefile';
import {
  actionsMapName,
  avatarMapName,
  appsMapName,
  playersMapName,
  crouchMaxTime,
  activateMaxTime,
  // useMaxTime,
  avatarInterpolationFrameRate,
  avatarInterpolationTimeDelay,
  avatarInterpolationNumFrames,
  // groundFriction,
  defaultPlayerName,
  voiceEndpoint,
} from './constants.js';
import {AppManager} from './app-manager.js';
import {CharacterPhysics} from './character-physics.js';
import {CharacterHups} from './character-hups.js';
import {CharacterSfx} from './character-sfx.js';
import {CharacterFx} from './character-fx.js';
import {VoicePack} from './voice-pack-voicer.js';
import {VoiceEndpoint} from './voice-endpoint-voicer.js';
import {BinaryInterpolant, BiActionInterpolant, UniActionInterpolant, InfiniteActionInterpolant, PositionInterpolant, QuaternionInterpolant, FixedTimeStep} from './interpolants.js';
import {applyPlayerToAvatar, switchAvatar} from './player-avatar-binding.js';
import {makeId, clone, unFrustumCull, enableShadows} from './util.js';

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localQuaternion2 = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
const localMatrix2 = new THREE.Matrix4();
const localArray3 = [0, 0, 0];
const localArray4 = [0, 0, 0, 0];

function makeCancelFn() {
  let live = true;
  return {
    isLive() {
      return live;
    },
    cancel() {
      live = false;
    },
  };
}
const heightFactor = 1.6;
const baseRadius = 0.3;
function loadPhysxCharacterController() {
  const avatarHeight = this.avatar.height;
  const radius = baseRadius/heightFactor * avatarHeight;
  const height = avatarHeight - radius*2;

  const contactOffset = 0.1/heightFactor * avatarHeight;
  const stepOffset = 0.5/heightFactor * avatarHeight;

  const position = this.position.clone()
    .add(new THREE.Vector3(0, -avatarHeight/2, 0));
  const physicsMaterial = new THREE.Vector3(0, 0, 0);

  if (this.characterController) {
    physicsManager.destroyCharacterController(this.characterController);
    this.characterController = null;
    // this.characterControllerObject = null;
  }
  this.characterController = physicsManager.createCharacterController(
    radius - contactOffset,
    height,
    contactOffset,
    stepOffset,
    position,
    physicsMaterial
  );
  // this.characterControllerObject = new THREE.Object3D();
}
/* function loadPhysxAuxCharacterCapsule() {
  const avatarHeight = this.avatar.height;
  const radius = baseRadius/heightFactor * avatarHeight;
  const height = avatarHeight - radius*2;
  const halfHeight = height/2;

  const position = this.position.clone()
    .add(new THREE.Vector3(0, -avatarHeight/2, 0));
  const physicsMaterial = new THREE.Vector3(0, 0, 0);

  const physicsObject = physicsManager.addCapsuleGeometry(
    position,
    localQuaternion.copy(this.quaternion)
      .premultiply(
        localQuaternion2.setFromAxisAngle(
          localVector.set(0, 0, 1),
          Math.PI/2
        )
      ),
    radius,
    halfHeight,
    physicsMaterial,
    true
  );
  physicsObject.name = 'characterCapsuleAux';
  physicsManager.setGravityEnabled(physicsObject, false);
  physicsManager.setLinearLockFlags(physicsObject.physicsId, false, false, false);
  physicsManager.setAngularLockFlags(physicsObject.physicsId, false, false, false);
  this.physicsObject = physicsObject;
} */

class PlayerHand extends THREE.Object3D {
  constructor() {
    super();

    this.pointer = 0;
    this.grab = 0;
    this.enabled = false;
  }
}
class PlayerBase extends THREE.Object3D {
  constructor() {
    super();

    this.leftHand = new PlayerHand();
    this.rightHand = new PlayerHand();
    this.hands = [
      this.leftHand,
      this.rightHand,
    ];
    this.avatar = null;
    this.eyeballTarget = new THREE.Vector3();
    this.eyeballTargetEnabled = false;
  }
  findAction(fn) {
    const actions = this.getActionsState();
    for (const action of actions) {
      if (fn(action)) {
        return action;
      }
    }
    return null;
  }
  findActionIndex(fn) {
    const actions = this.getActionsState();
    let i = 0;
    for (const action of actions) {
      if (fn(action)) {
        return i;
      }
      i++
    }
    return -1;
  }
  getAction(type) {
    const actions = this.getActionsState();
    for (const action of actions) {
      if (action.type === type) {
        return action;
      }
    }
    return null;
  }
  getActionByActionId(actionId) {
    const actions = this.getActionsState();
    for (const action of actions) {
      if (action.actionId === actionId) {
        return action;
      }
    }
    return null;
  }
  getActionIndex(type) {
    const actions = this.getActionsState();
    let i = 0;
    for (const action of actions) {
      if (action.type === type) {
        return i;
      }
      i++;
    }
    return -1;
  }
  indexOfAction(action) {
    const actions = this.getActionsState();
    let i = 0;
    for (const a of actions) {
      if (a === action) {
        return i;
      }
      i++;
    }
    return -1;
  }
  hasAction(type) {
    const actions = this.getActionsState();
    for (const action of actions) {
      if (action.type === type) {
        return true;
      }
    }
    return false;
  }
  async loadVoicePack({audioUrl, indexUrl}) {
    const voicePack = await VoicePack.load({
      audioUrl,
      indexUrl,
    });
    this.characterHups.setVoice(voicePack);
  }
  setVoice(voiceId) {
    const url = `${voiceEndpoint}?voice=${encodeURIComponent(voiceId)}`;
    const voice = new VoiceEndpoint(url);
    this.characterHups.setVoice(voice);
  }
  getCrouchFactor() {
    return 1 - 0.4 * this.actionInterpolants.crouch.getNormalized();
    /* let factor = 1;
    factor *= 1 - 0.4 * this.actionInterpolants.crouch.getNormalized();
    return factor; */
  }
  destroy() {
    // nothing
  }
}
const controlActionTypes = [
  'jump',
  'crouch',
  'fly',
  'sit',
];
class StatePlayer extends PlayerBase {
  constructor({
    playerId = makeId(5),
    playersArray = new Z.Doc().getArray(playersMapName),
  } = {}) {
    super();

    this.playerId = playerId;
    this.playersArray = null;
    this.playerMap = null;
    this.microphoneMediaStream = null;

    this.appManager = new AppManager({
      appsMap: null,
    });
    this.appManager.addEventListener('appadd', e => {
      const app = e.data;
      scene.add(app);
    });
    this.appManager.addEventListener('appremove', e => {
      const app = e.data;
      app.parent && app.parent.remove(app);
    });
    
    this.avatarEpoch = 0;
    this.syncAvatarCancelFn = null;
    this.unbindFns = [];
    
    this.bindState(playersArray);
  }
  isBound() {
    return !!this.playersArray;
  }
  unbindState() {
    if (this.isBound()) {
      this.playersArray = null;
      this.playerMap = null;

      for (const unbindFn of this.unbindFns) {
        unbindFn();
      }
      this.unbindFns.length = 0;
    }
  }
  detachState() {
    throw new Error('called abstract method');
  }
  attachState(oldState) {
    throw new Error('called abstract method');
  }
  bindCommonObservers() {
    const actions = this.getActionsState();
    let lastActions = actions.toJSON();
    const observeActionsFn = () => {
      const nextActions = Array.from(this.getActionsState());
      for (const nextAction of nextActions) {
        if (!lastActions.some(lastAction => lastAction.actionId === nextAction.actionId)) {
          this.dispatchEvent({
            type: 'actionadd',
            action: nextAction,
          });
          // console.log('add action', nextAction);
        }
      }
      for (const lastAction of lastActions) {
        if (!nextActions.some(nextAction => nextAction.actionId === lastAction.actionId)) {
          this.dispatchEvent({
            type: 'actionremove',
            action: lastAction,
          });
          // console.log('remove action', lastAction);
        }
      }
      // console.log('actions changed');
      lastActions = nextActions;
    };
    actions.observe(observeActionsFn);
    this.unbindFns.push(actions.unobserve.bind(actions, observeActionsFn));
    
    const avatar = this.getAvatarState();
    let lastAvatarInstanceId = '';
    const observeAvatarFn = async () => {
      // we are in an observer and we want to perform a state transaction as a result
      // therefore we need to yeild out of the observer first or else the other transaction handlers will get confused about timing
      await Promise.resolve();
      
      const instanceId = this.getAvatarInstanceId();
      if (lastAvatarInstanceId !== instanceId) {
        lastAvatarInstanceId = instanceId;
        
        this.syncAvatar();
      }
    };
    avatar.observe(observeAvatarFn);
    this.unbindFns.push(avatar.unobserve.bind(avatar, observeAvatarFn));
    
    const _cancelSyncAvatar = () => {
      if (this.syncAvatarCancelFn) {
        this.syncAvatarCancelFn();
        this.syncAvatarCancelFn = null;
      }
    };
    this.unbindFns.push(_cancelSyncAvatar);
  }
  bindState(nextPlayersArray) {
    // latch old state
    const oldState = this.detachState();
    
    // unbind
    this.unbindState();
    this.appManager.unbindState();
    
    // note: leave the old state as is. it is the host's responsibility to garbage collect us when we disconnect.
    
    // blindly add to new state
    this.playersArray = nextPlayersArray;
    if (this.playersArray) {
      this.attachState(oldState);
      this.bindCommonObservers();
    }
  }
  getAvatarInstanceId() {
    return this.getAvatarState().get('instanceId') ?? '';
  }
  // serializers
  getPosition() {
    return this.playerMap.get('position') ?? [0, 0, 0];
  }
  getQuaternion() {
    return this.playerMap.get('quaternion') ?? [0, 0, 0, 1];
  }
  async syncAvatar() {
    if (this.syncAvatarCancelFn) {
      this.syncAvatarCancelFn.cancel();
      this.syncAvatarCancelFn = null;
    }
    const cancelFn = makeCancelFn();
    this.syncAvatarCancelFn = cancelFn;
    
    const instanceId = this.getAvatarInstanceId();
    
    // remove last app
    if (this.avatar) {
      const oldPeerOwnerAppManager = this.appManager.getPeerOwnerAppManager(this.avatar.app.instanceId);
      if (oldPeerOwnerAppManager) {
        // console.log('transplant last app');
        this.appManager.transplantApp(this.avatar.app, oldPeerOwnerAppManager);
      } else {
        // console.log('remove last app', this.avatar.app);
        // this.appManager.removeTrackedApp(this.avatar.app.instanceId);
      }
    }
    
    const _setNextAvatarApp = app => {
      (async () => {
        const nextAvatar = await switchAvatar(this.avatar, app);
        if (!cancelFn.isLive()) return;
        this.avatar = nextAvatar;

        this.dispatchEvent({
          type: 'avatarchange',
          app,
        });
        
        loadPhysxCharacterController.call(this);
        // console.log('disable actor', this.characterController);
        physicsManager.disableGeometryQueries(this.characterController);
      })();
      
      this.dispatchEvent({
        type: 'avatarupdate',
        app,
      });
    };
    
    if (instanceId) {
      // add next app from player app manager
      const nextAvatarApp = this.appManager.getAppByInstanceId(instanceId);
      // console.log('add next avatar local', nextAvatarApp);
      if (nextAvatarApp) {
        _setNextAvatarApp(nextAvatarApp);
      } else {
        // add next app from world app manager
        const nextAvatarApp = world.appManager.getAppByInstanceId(instanceId);
        // console.log('add next avatar world', nextAvatarApp);
        if (nextAvatarApp) {
          world.appManager.transplantApp(nextAvatarApp, this.appManager);
          _setNextAvatarApp(nextAvatarApp);
        } else {
          // add next app from currently loading apps
          const addPromise = this.appManager.pendingAddPromises.get(instanceId);
          if (addPromise) {
            const nextAvatarApp = await addPromise;
            if (!cancelFn.isLive()) return;
            _setNextAvatarApp(nextAvatarApp);
          } else {
            console.warn('switching avatar to instanceId that does not exist in any app manager', instanceId);
          }
        }
      }
    } else {
      _setNextAvatarApp(null);
    }
    
    this.syncAvatarCancelFn = null;
  }
  getActions() {
    return this.getActionsState();
  }
  getActionsState() {
    let actionsArray = this.playerMap.has(avatarMapName) ? this.playerMap.get(actionsMapName, Z.Array) : null;
    if (!actionsArray) {
      actionsArray = new Z.Array();
      this.playerMap.set(actionsMapName, actionsArray);
    }
    return actionsArray;
  }
  getActionsArray() {
    return this.isBound() ? Array.from(this.getActionsState()) : [];
  }
  getAvatarState() {
    let avatarMap = this.playerMap.has(avatarMapName) ? this.playerMap.get(avatarMapName, Z.Map) : null;
    if (!avatarMap) {
      avatarMap = new Z.Map();
      this.playerMap.set(avatarMapName, avatarMap);
    }
    return avatarMap;
  }
  getAppsState() {
    let appsArray = this.playerMap.has(avatarMapName) ? this.playerMap.get(appsMapName, Z.Array) : null;
    if (!appsArray) {
      appsArray = new Z.Array();
      this.playerMap.set(appsMapName, appsArray);
    }
    return appsArray;
  }
  getAppsArray() {
    return this.isBound() ? Array.from(this.getAppsState()) : [];
  }
  addAction(action) {
    action = clone(action);
    action.actionId = makeId(5);
    this.getActionsState().push([action]);
  }
  removeAction(type) {
    const actions = this.getActionsState();
    let i = 0;
    for (const action of actions) {
      if (action.type === type) {
        actions.delete(i);
        break;
      }
      i++;
    }
  }
  removeActionIndex(index) {
    this.getActionsState().delete(index);
  }
  setControlAction(action) {
    const actions = this.getActionsState();
    for (let i = 0; i < actions.length; i++) {
      const action = actions.get(i);
      const isControlAction = controlActionTypes.includes(action.type);
      if (isControlAction) {
        actions.delete(i);
        i--;
      }
    }
    actions.push([action]);
  }
  setMicMediaStream(mediaStream) {
    if (this.microphoneMediaStream) {
      this.microphoneMediaStream.disconnect();
      this.microphoneMediaStream = null;
    }
    if (mediaStream) {
      this.avatar.setAudioEnabled(true);
      const audioContext = Avatar.getAudioContext();
      const mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);
      mediaStreamSource.connect(this.avatar.getAudioInput());
      this.microphoneMediaStream = mediaStreamSource;
    }
  }
  new() {
    const self = this;
    this.playersArray.doc.transact(function tx() {
      const actions = self.getActionsState();
      while (actions.length > 0) {
        actions.delete(actions.length - 1);
      }
      
      const avatar = self.getAvatarState();
      avatar.delete('instanceId');
      
      const apps = self.getAppsState();
      while (apps.length > 0) {
        apps.delete(apps.length - 1);
      }
    });
  }
  save() {
    const actions = this.getActionsState();
    const avatar = this.getAvatarState();
    const apps = this.getAppsState();
    return JSON.stringify({
      // actions: actions.toJSON(),
      avatar: avatar.toJSON(),
      apps: apps.toJSON(),
    });
  }
  load(s) {
    const j = JSON.parse(s);
    // console.log('load', j);
    const self = this;
    this.playersArray.doc.transact(function tx() {
      const actions = self.getActionsState();
      while (actions.length > 0) {
        actions.delete(actions.length - 1);
      }
      
      const avatar = self.getAvatarState();
      if (j?.avatar?.instanceId) {
        avatar.set('instanceId', j.avatar.instanceId);
      }
      
      const apps = self.getAppsState();
      if (Array.isArray(j?.apps)) {
        for (const app of j.apps) {
          apps.push([app]);
        }
      }
    });
  }
  updateAvatar(timestamp, timeDiff) {
    if (this.avatar) {
      this.updateInterpolation(timeDiff);
      
      const renderer = getRenderer();
      const session = renderer.xr.getSession();
      const mirrors = metaversefile.getMirrors();
      applyPlayerToAvatar(this, session, this.avatar, mirrors);

      this.avatar.update(timestamp, timeDiff);
    }
    this.characterHups.update(timestamp);
  }
  destroy() {
    this.unbindState();
    this.appManager.unbindState();

    this.appManager.destroy();
  
    super.destroy();
  }
}
class InterpolatedPlayer extends StatePlayer {
  constructor(opts) {
    super(opts);
    
    this.positionInterpolant = new PositionInterpolant(() => this.getPosition(), avatarInterpolationTimeDelay, avatarInterpolationNumFrames);
    this.quaternionInterpolant = new QuaternionInterpolant(() => this.getQuaternion(), avatarInterpolationTimeDelay, avatarInterpolationNumFrames);
    this.positionTimeStep = new FixedTimeStep(timeDiff => {
      this.positionInterpolant.snapshot(timeDiff);
    }, avatarInterpolationFrameRate);
    this.quaternionTimeStep = new FixedTimeStep(timeDiff => {
      this.quaternionInterpolant.snapshot(timeDiff);
    }, avatarInterpolationFrameRate);
    
    this.actionBinaryInterpolants = {
      crouch: new BinaryInterpolant(() => this.hasAction('crouch'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      activate: new BinaryInterpolant(() => this.hasAction('activate'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      use: new BinaryInterpolant(() => this.hasAction('use'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      aim: new BinaryInterpolant(() => this.hasAction('aim'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      narutoRun: new BinaryInterpolant(() => this.hasAction('narutoRun'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      fly: new BinaryInterpolant(() => this.hasAction('fly'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      jump: new BinaryInterpolant(() => this.hasAction('jump'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      dance: new BinaryInterpolant(() => this.hasAction('dance'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      // throw: new BinaryInterpolant(() => this.hasAction('throw'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      // chargeJump: new BinaryInterpolant(() => this.hasAction('chargeJump'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      // standCharge: new BinaryInterpolant(() => this.hasAction('standCharge'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      fallLoop: new BinaryInterpolant(() => this.hasAction('fallLoop'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      swordSideSlash: new BinaryInterpolant(() => this.hasAction('swordSideSlash'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      swordTopDownSlash: new BinaryInterpolant(() => this.hasAction('swordTopDownSlash'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
    };
    this.actionBinaryInterpolantsArray = Object.keys(this.actionBinaryInterpolants).map(k => this.actionBinaryInterpolants[k]);
    this.actionBinaryTimeSteps = {
      crouch: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.crouch.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      activate: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.activate.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      use: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.use.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      aim: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.aim.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      narutoRun: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.narutoRun.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      fly: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.fly.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      jump: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.jump.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      dance: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.dance.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      // throw: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.throw.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      // chargeJump: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.chargeJump.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      // standCharge: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.standCharge.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      fallLoop: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.fallLoop.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      swordSideSlash: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.swordSideSlash.snapshot(timeDiff);}, avatarInterpolationFrameRate),
      swordTopDownSlash: new FixedTimeStep(timeDiff => {this.actionBinaryInterpolants.swordTopDownSlash.snapshot(timeDiff);}, avatarInterpolationFrameRate),
    };
    this.actionBinaryTimeStepsArray = Object.keys(this.actionBinaryTimeSteps).map(k => this.actionBinaryTimeSteps[k]);
    this.actionInterpolants = {
      crouch: new BiActionInterpolant(() => this.actionBinaryInterpolants.crouch.get(), 0, crouchMaxTime),
      activate: new UniActionInterpolant(() => this.actionBinaryInterpolants.activate.get(), 0, activateMaxTime),
      use: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.use.get(), 0),
      aim: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.aim.get(), 0),
      narutoRun: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.narutoRun.get(), 0),
      fly: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.fly.get(), 0),
      jump: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.jump.get(), 0),
      dance: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.dance.get(), 0),
      // throw: new UniActionInterpolant(() => this.actionBinaryInterpolants.throw.get(), 0, throwMaxTime),
      // chargeJump: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.chargeJump.get(), 0),
      // standCharge: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.standCharge.get(), 0),
      fallLoop: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.fallLoop.get(), 0),
      swordSideSlash: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.swordSideSlash.get(), 0),
      swordTopDownSlash: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.swordTopDownSlash.get(), 0),
    };
    this.actionInterpolantsArray = Object.keys(this.actionInterpolants).map(k => this.actionInterpolants[k]);
    
    this.avatarBinding = {
      position: this.positionInterpolant.get(),
      quaternion: this.quaternionInterpolant.get(),
    };
  }
  updateInterpolation(timeDiff) {
    this.positionTimeStep.update(timeDiff);
    this.quaternionTimeStep.update(timeDiff);
    
    this.positionInterpolant.update(timeDiff);
    this.quaternionInterpolant.update(timeDiff);
    
    for (const actionInterpolantTimeStep of this.actionBinaryTimeStepsArray) {
      actionInterpolantTimeStep.update(timeDiff);
    }
    for (const actionBinaryInterpolant of this.actionBinaryInterpolantsArray) {
      actionBinaryInterpolant.update(timeDiff);
    }
    for (const actionInterpolant of this.actionInterpolantsArray) {
      actionInterpolant.update(timeDiff);
    }
  }
}
class UninterpolatedPlayer extends StatePlayer {
  constructor(opts) {
    super(opts);
    
    UninterpolatedPlayer.init.apply(this, arguments)
  }
  static init() {
    this.actionInterpolants = {
      crouch: new BiActionInterpolant(() => this.hasAction('crouch'), 0, crouchMaxTime),
      activate: new UniActionInterpolant(() => this.hasAction('activate'), 0, activateMaxTime),
      use: new InfiniteActionInterpolant(() => this.hasAction('use'), 0),
      aim: new InfiniteActionInterpolant(() => this.hasAction('aim'), 0),
      narutoRun: new InfiniteActionInterpolant(() => this.hasAction('narutoRun'), 0),
      fly: new InfiniteActionInterpolant(() => this.hasAction('fly'), 0),
      jump: new InfiniteActionInterpolant(() => this.hasAction('jump'), 0),
      dance: new BiActionInterpolant(() => this.hasAction('dance'), 0, crouchMaxTime),
      // throw: new UniActionInterpolant(() => this.hasAction('throw'), 0, throwMaxTime),
      // chargeJump: new InfiniteActionInterpolant(() => this.hasAction('chargeJump'), 0),
      // standCharge: new InfiniteActionInterpolant(() => this.hasAction('standCharge'), 0),
      fallLoop: new InfiniteActionInterpolant(() => this.hasAction('fallLoop'), 0),
      // swordSideSlash: new InfiniteActionInterpolant(() => this.hasAction('swordSideSlash'), 0),
      // swordTopDownSlash: new InfiniteActionInterpolant(() => this.hasAction('swordTopDownSlash'), 0),
    };
    this.actionInterpolantsArray = Object.keys(this.actionInterpolants).map(k => this.actionInterpolants[k]);

    this.avatarBinding = {
      position: this.position,
      quaternion: this.quaternion,
    };
  }
  updateInterpolation(timeDiff) {
    for (const actionInterpolant of this.actionInterpolantsArray) {
      actionInterpolant.update(timeDiff);
    }
  }
}
class LocalPlayer extends UninterpolatedPlayer {
  constructor(opts) {
    super(opts);

    this.isLocalPlayer = true;

    this.name = defaultPlayerName;
    this.characterPhysics = new CharacterPhysics(this);
    this.characterHups = new CharacterHups(this);
    this.characterSfx = new CharacterSfx(this);
    this.characterFx = new CharacterFx(this);
  }
  async setAvatarUrl(u) {
    const localAvatarEpoch = ++this.avatarEpoch;
    const avatarApp = await this.appManager.addTrackedApp(u);
    if (this.avatarEpoch !== localAvatarEpoch) {
      this.appManager.removeTrackedApp(avatarApp.instanceId);
      return;
    }
    
    this.setAvatarApp(avatarApp);
  }
  setAvatarApp(app) {
    const self = this;
    this.playersArray.doc.transact(function tx() {
      const avatar = self.getAvatarState();
      const oldInstanceId = avatar.get('instanceId');
      
      avatar.set('instanceId', app.instanceId);

      if (oldInstanceId) {
        self.appManager.removeTrackedAppInternal(oldInstanceId);
      }
    });
  }
  detachState() {
    const oldActions = (this.playersArray ? this.getActionsState() : new Z.Array());
    const oldAvatar = (this.playersArray ? this.getAvatarState() : new Z.Map()).toJSON();
    const oldApps = (this.playersArray ? this.getAppsState() : new Z.Array()).toJSON();
    return {
      oldActions,
      oldAvatar,
      oldApps,
    };
  }
  attachState(oldState) {
    const {
      oldActions,
      oldAvatar,
      oldApps,
    } = oldState;
    
    const self = this;
    this.playersArray.doc.transact(function tx() {
      self.playerMap = new Z.Map();
      self.playersArray.push([self.playerMap]);
      self.playerMap.set('playerId', self.playerId);
      self.playerMap.set('position', self.position.toArray(localArray3));
      self.playerMap.set('quaternion', self.quaternion.toArray(localArray4));
      
      const actions = self.getActionsState();
      for (const oldAction of oldActions) {
        actions.push([oldAction]);
      }
      
      const avatar = self.getAvatarState();
      const {instanceId} = oldAvatar;
      if (instanceId !== undefined) {
        avatar.set('instanceId', instanceId);
      }
      
      const apps = self.getAppsState();
      for (const oldApp of oldApps) {
        const mapApp = new Z.Map();
        for (const k in oldApp) {
          const v = oldApp[k];
          mapApp.set(k, v);
        }
        apps.push([mapApp]);
      }
    });
    
    this.appManager.bindState(this.getAppsState());
  }
  wear(app) {
    app.dispatchEvent({
      type: 'wearupdate',
      wear: true,
    });
    
    if (world.appManager.hasTrackedApp(app.instanceId)) {
      world.appManager.transplantApp(app, this.appManager);
    } else {
      // console.warn('need to transplant unowned app', app, world.appManager, this.appManager);
      // debugger;
    }
    
    const physicsObjects = app.getPhysicsObjects();
    for (const physicsObject of physicsObjects) {
      physx.physxWorker.disableGeometryQueriesPhysics(physx.physics, physicsObject.physicsId);
      physx.physxWorker.disableGeometryPhysics(physx.physics, physicsObject.physicsId);
    }
    
    const {instanceId} = app;
    this.addAction({
      type: 'wear',
      instanceId,
    });
    this.ungrab();
    
    this.dispatchEvent({
      type: 'wearupdate',
      app,
      wear: true,
    });
  }
  unwear(app) {
    const wearActionIndex = this.findActionIndex(({type, instanceId}) => {
      return type === 'wear' && instanceId === app.instanceId;
    });
    if (wearActionIndex !== -1) {
      this.removeActionIndex(wearActionIndex);
      
      if (this.appManager.hasTrackedApp(app.instanceId)) {
        this.appManager.transplantApp(app, world.appManager);
      } else {
        // console.warn('need to transplant unowned app', app, this.appManager, world.appManager);
        // debugger;
      }
      
      const wearComponent = app.getComponent('wear');
      if (wearComponent) {
        const avatarHeight = this.avatar ? this.avatar.height : 0;
        app.position.copy(this.position)
          .add(localVector.set(0, -avatarHeight + 0.5, -0.5).applyQuaternion(this.quaternion));
        app.quaternion.identity();
        app.scale.set(1, 1, 1);
        app.updateMatrixWorld();
      }

      const physicsObjects = app.getPhysicsObjects();
      for (const physicsObject of physicsObjects) {
        physx.physxWorker.enableGeometryQueriesPhysics(physx.physics, physicsObject.physicsId);
        physx.physxWorker.enableGeometryPhysics(physx.physics, physicsObject.physicsId);
      }
      
      app.dispatchEvent({
        type: 'wearupdate',
        wear: false,
      });
      this.dispatchEvent({
        type: 'wearupdate',
        app,
        wear: false,
      });
    }
  }
  grab(app, hand = 'left') {
    const renderer = getRenderer();
    const localPlayer = metaversefile.useLocalPlayer();
    const {position, quaternion} = renderer.xr.getSession() ?
      localPlayer[hand === 'left' ? 'leftHand' : 'rightHand']
    :
      camera;

    app.updateMatrixWorld();
    app.savedRotation = app.rotation.clone();
    app.startQuaternion = quaternion.clone();

    const grabAction = {
      type: 'grab',
      hand,
      instanceId: app.instanceId,
      matrix: localMatrix.copy(app.matrixWorld)
        .premultiply(localMatrix2.compose(position, quaternion, localVector.set(1, 1, 1)).invert())
        .toArray()
    };
    localPlayer.addAction(grabAction);
    
    const physicsObjects = app.getPhysicsObjects();
    for (const physicsObject of physicsObjects) {
      //physx.physxWorker.disableGeometryPhysics(physx.physics, physicsObject.physicsId);
      physx.physxWorker.disableGeometryQueriesPhysics(physx.physics, physicsObject.physicsId);
    }

    app.dispatchEvent({
      type: 'grabupdate',
      grab: true,
    });
  }
  ungrab() {
    const actions = Array.from(this.getActionsState());
    let removeOffset = 0;
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.type === 'grab') {
        const app = metaversefile.getAppByInstanceId(action.instanceId);
        const physicsObjects = app.getPhysicsObjects();
        for (const physicsObject of physicsObjects) {
          //physx.physxWorker.enableGeometryPhysics(physx.physics, physicsObject.physicsId);
          physx.physxWorker.enableGeometryQueriesPhysics(physx.physics, physicsObject.physicsId);
        }
        this.removeActionIndex(i + removeOffset);
        removeOffset -= 1;

        app.dispatchEvent({
          type: 'grabupdate',
          grab: false,
        });
      }
    }
  }
  lookAt(p) {
    const cameraOffset = cameraManager.getCameraOffset();
    camera.position.add(localVector.copy(cameraOffset).applyQuaternion(camera.quaternion));
    camera.quaternion.setFromRotationMatrix(
      localMatrix.lookAt(
        camera.position,
        p,
        localVector2.set(0, 1, 0)
      )
    );
    camera.position.sub(localVector.copy(cameraOffset).applyQuaternion(camera.quaternion));
    camera.updateMatrixWorld();
    
    /* this.quaternion.setFromRotationMatrix(
      localMatrix.lookAt(this.position, p, upVector)
    );
    teleportTo(this.position, this.quaternion, {
      relation: 'head',
    }); */
  }
  pushPlayerUpdates() {
    this.playersArray.doc.transact(() => {
      /* if (isNaN(this.position.x) || isNaN(this.position.y) || isNaN(this.position.z)) {
        debugger;
      } */
      this.playerMap.set('position', this.position.toArray(localArray3));
      this.playerMap.set('quaternion', this.quaternion.toArray(localArray4));
    }, 'push');
  }
  updatePhysics(timestamp, timeDiff) {
    const timeDiffS = timeDiff / 1000;
    this.characterPhysics.update(timestamp, timeDiffS);
    this.characterSfx.update(timestamp, timeDiffS);
    this.characterFx.update(timestamp, timeDiffS);
  }
  resetPhysics() {
    this.characterPhysics.reset();
  }
  teleportTo = (() => {
    const localVector = new THREE.Vector3();
    const localVector2 = new THREE.Vector3();
    const localQuaternion = new THREE.Quaternion();
    const localMatrix = new THREE.Matrix4();
    return function(position, quaternion, {relation = 'floor'} = {}) {
      const renderer = getRenderer();
      const xrCamera = renderer.xr.getSession() ? renderer.xr.getCamera(camera) : camera;

      const avatarHeight = this.avatar ? this.avatar.height : 0;
      if (renderer.xr.getSession()) {
        localMatrix.copy(xrCamera.matrix)
          .premultiply(dolly.matrix)
          .decompose(localVector, localQuaternion, localVector2);
          
        dolly.matrix
          .premultiply(localMatrix.makeTranslation(position.x - localVector.x, position.y - localVector.y, position.z - localVector.z))
          // .premultiply(localMatrix.makeRotationFromQuaternion(localQuaternion3.copy(quaternion).inverse()))
          // .premultiply(localMatrix.makeTranslation(localVector.x, localVector.y, localVector.z))
          .premultiply(localMatrix.makeTranslation(0, relation === 'floor' ? avatarHeight : 0, 0))
          .decompose(dolly.position, dolly.quaternion, dolly.scale);
        dolly.updateMatrixWorld();
      } else {
        camera.position.copy(position)
          .sub(localVector.copy(cameraManager.getCameraOffset()).applyQuaternion(camera.quaternion));
        camera.position.y += relation === 'floor' ? avatarHeight : 0;
        camera.quaternion.copy(quaternion);
        camera.updateMatrixWorld();
      }

      this.resetPhysics();
    };
  })()
  destroy() {
    this.characterPhysics.destroy();
    this.characterHups.destroy();
    this.characterSfx.destroy();
    this.characterFx.destroy();

    super.destroy();
  }
}
class RemotePlayer extends InterpolatedPlayer {
  constructor(opts) {
    super(opts);
  
    this.isRemotePlayer = true;
  }
  detachState() {
    return null;
  }
  attachState(oldState) {
    let index = -1;
    for (let i = 0; i < this.playersArray.length; i++) {
      const player = this.playersArray.get(i, Z.Map);
      if (player.get('playerId') === this.playerId) {
        index = i;
        break;
      }
    }
    if (index !== -1) {
      this.playerMap = this.playersArray.get(index, Z.Map);
    } else {
      console.warn('binding to nonexistent player object', this.playersArray.toJSON());
    }
    
    const observePlayerFn = e => {
      this.position.fromArray(this.playerMap.get('position'));
      this.quaternion.fromArray(this.playerMap.get('quaternion'));
    };
    this.playerMap.observe(observePlayerFn);
    this.unbindFns.push(this.playerMap.unobserve.bind(this.playerMap, observePlayerFn));
    
    this.appManager.bindState(this.getAppsState());
    this.appManager.syncApps();
    
    this.syncAvatar();
  }
}
class StaticUninterpolatedPlayer extends PlayerBase {
  constructor(opts) {
    super(opts);

    UninterpolatedPlayer.init.apply(this, arguments);

    this.actions = [];
  }
  getActionsState() {
    return this.actions;
  }
  getActions() {
    return this.getActionsState();
  }
  getAction(type) {
    return this.actions.find(action => action.type === type);
  }
  getActionByActionId(actionId) {
    return this.actions.find(action => action.actionId === actionId);
  }
  hasAction(type) {
    return this.actions.some(a => a.type === type);
  }
  addAction(action) {
    this.actions.push(action);

    this.dispatchEvent({
      type: 'actionadd',
      action,
    });
  }
  removeAction(type) {
    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      if (action.type === type) {
        this.removeActionIndex(i);
        break;
      }
    }
  }
  removeActionIndex(index) {
    const action = this.actions.splice(index, 1)[0];
    this.dispatchEvent({
      type: 'actionremove',
      action,
    });
  }
  updateInterpolation = UninterpolatedPlayer.prototype.updateInterpolation;
}
class NpcPlayer extends StaticUninterpolatedPlayer {
  constructor(opts) {
    super(opts);
  
    this.isNpcPlayer = true;
  }
  async setAvatarAppAsync(app) {
    await app.setSkinning(true);
    
    const {skinnedVrm} = app;
    const avatar = new Avatar(skinnedVrm, {
      fingers: true,
      hair: true,
      visemes: true,
      debug: false,
    });
  
    unFrustumCull(app);
    enableShadows(app);
  
    this.avatar = avatar;

    this.characterPhysics = new CharacterPhysics(this);
    this.characterHups = new CharacterHups(this);
    this.characterSfx = new CharacterSfx(this);
    this.characterFx = new CharacterFx(this);
    
    loadPhysxCharacterController.call(this);
    // loadPhysxAuxCharacterCapsule.call(this);
  }
  updatePhysics(timestamp, timeDiff) {
    if (this.avatar) {
      const timeDiffS = timeDiff / 1000;
      this.characterPhysics.update(timestamp, timeDiffS);
      this.characterSfx.update(timestamp, timeDiffS);
      this.characterFx.update(timestamp, timeDiffS);
    }
  }
  updateAvatar(timestamp, timeDiff) {
    if (this.avatar) {
      // this.updateInterpolation(timeDiff);
      
      // const renderer = getRenderer();
      // const session = renderer.xr.getSession();
      const mirrors = metaversefile.getMirrors();
      applyPlayerToAvatar(this, null, this.avatar, mirrors);

      this.avatar.update(timestamp, timeDiff);

      /* this.physicsObject.position.copy(this.position)
        .add(new THREE.Vector3(0, -this.avatar.height/2, 0));
      this.physicsObject.updateMatrixWorld();
      physicsManager.setTransform(this.physicsObject); */

      this.characterHups.update(timestamp);
    }
  }
  /* detachState() {
    return null;
  }
  attachState(oldState) {
    let index = -1;
    for (let i = 0; i < this.playersArray.length; i++) {
      const player = this.playersArray.get(i, Z.Map);
      if (player.get('playerId') === this.playerId) {
        index = i;
        break;
      }
    }
    if (index !== -1) {
      this.playerMap = this.playersArray.get(index, Z.Map);
    } else {
      console.warn('binding to nonexistent player object', this.playersArray.toJSON());
    }
    
    const observePlayerFn = e => {
      this.position.fromArray(this.playerMap.get('position'));
      this.quaternion.fromArray(this.playerMap.get('quaternion'));
    };
    this.playerMap.observe(observePlayerFn);
    this.unbindFns.push(this.playerMap.unobserve.bind(this.playerMap, observePlayerFn));
    
    this.appManager.bindState(this.getAppsState());
    this.appManager.syncApps();
    
    this.syncAvatar();
  } */
  destroy() {
    /* const npcs = metaversefile.useNpcs();
    const index = npcs.indexOf(this);
    if (index !== -1) {
      npcs.splice(index, 1);
    } */

    super.destroy();
  }
}

export {
  LocalPlayer,
  RemotePlayer,
  NpcPlayer,
};