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

async function initONNX() {
    try {
        session = await ort.InferenceSession.create('best_v3.onnx', {
            executionProviders: ['wasm', 'webgl']
        });
        updateStatus('✅ Model loaded');
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
    updateStatus('Ready — tap Start Camera');
}

function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

function setupUI() {
    document.getElementById('btnWebcam').onclick = startWebcam;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnStart').onclick = startPlayback;
}

async function startWebcam() {
    try {
        // Prefer environment camera on mobile
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;           // Critical for iOS
        await video.play();
        
        // Set canvas to match video aspect
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        
        isRunning = true;
        document.getElementById('btnStart').disabled = false;
        updateStatus('Camera active — Recalibrate when piano visible');
        loop();
    } catch (e) {
        updateStatus('Camera access denied');
        console.error(e);
    }
}

async function calibrate() {
    if (!video || !session) return;
    updateStatus('Detecting keys...');
    const kps = await keypointManager.getKeypoints(video, session);
    if (kps?.length >= 2) {
        keypointManager.computeHomography(kps);
        pianoManager.initKeys();
        updateStatus(`Calibrated with ${kps.length} groups`);
    } else {
        updateStatus('Not enough keys detected — improve lighting');
    }
}

function selectMIDI() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = async e => {
        if (e.target.files[0]) {
            await midiManager.loadMIDI(e.target.files[0]);
            updateStatus('MIDI loaded');
        }
    };
    input.click();
}

function startPlayback() {
    started = true;
    midiManager.startTime = performance.now() / 1000;
    updateStatus('🎵 Playing');
}

function loop() {
    if (!isRunning) return;

    if (video) {
        // Draw video full area (no skew)
        ctx.save();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        if (started) {
            const currentTime = performance.now() / 1000;
            midiManager.drawVisualization(ctx, canvas.height, currentTime - midiManager.startTime);
        }
        ctx.restore();
    }

    requestAnimationFrame(loop);
}

window.onload = initTrackmaker;
