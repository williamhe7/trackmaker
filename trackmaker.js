// trackmaker.js
import { KeypointManager } from './keypointManager.js';
import { PianoManager } from './pianoManager.js';
import { MidiManager } from './midiManager.js';

let session = null;
let video = null;
let stream = null;
let canvas, ctx;
let keypointManager, pianoManager, midiManager;
let isRunning = false;
let started = false;
let isCalibrated = false;

async function initONNX() {
    try {
        session = await ort.InferenceSession.create('best_v3.onnx', {
            executionProviders: ['wasm', 'webgl']
        });
        updateStatus('✅ Model ready');
    } catch (e) {
        console.error(e);
        updateStatus('❌ Model load failed');
    }
}

export async function initTrackmaker() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    
    await initONNX();
    
    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180);

    setupUI();
    updateStatus('Tap "Start Camera"');
}

function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

function setupUI() {
    document.getElementById('btnWebcam').onclick = startWebcam;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnStart').onclick = startPlayback;
    document.getElementById('fullscreen-btn').onclick = toggleFullscreen;
}

function enableAfterCalibration() {
    isCalibrated = true;
    document.getElementById('btnMIDI').disabled = false;
    document.getElementById('btnStart').disabled = false;
}

async function startWebcam() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "user",        // SELFIE CAMERA as requested
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        isRunning = true;
        document.getElementById('btnCalibrate').disabled = false;
        updateStatus('Selfie camera active — Point at piano and Recalibrate');
        loop();
    } catch (e) {
        updateStatus('Camera failed:
