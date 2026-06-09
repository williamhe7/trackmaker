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
        updateStatus('❌ Model failed to load');
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
}

function enableControlsAfterCalibration() {
    isCalibrated = true;
    document.getElementById('btnMIDI').disabled = false;
    document.getElementById('btnStart').disabled = false;
}

async function startWebcam() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        await video.play();

        // Set canvas to full window size
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        isRunning = true;
        document.getElementById('btnCalibrate').disabled = false;
        updateStatus('Camera active — point at piano and tap Recalibrate');
        loop();
    } catch (e) {
        updateStatus('Camera access failed');
        console.error(e);
    }
}

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 140; // approx space for header + controls
}

async function calibrate() {
    if (!video || !session) return;
    updateStatus('Detecting piano keys...');
    
    const kps = await keypointManager.getKeypoints(video, session);
    if (kps?.length >= 2) {
        keypointManager.computeHomography(kps);
        pianoManager.initKeys();
        enableControlsAfterCalibration();
        updateStatus(`✅ Calibrated with ${kps.length} key groups`);
    } else {
        updateStatus('⚠️ Not enough keys. Try better angle/lighting.');
    }
}

function selectMIDI() {
    if (!isCalibrated) return;
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
    if (!isCalibrated) return;
    started = true;
    midiManager.startTime = performance.now() / 1000;
    updateStatus('🎵 Playback started');
}

function loop() {
    if (!isRunning || !video) return;

    // === FULL SCREEN WITH ASPECT RATIO PRESERVED ===
    const videoRatio = video.videoWidth / video.videoHeight;
    const canvasRatio = canvas.width / canvas.height;

    let drawWidth = canvas.width;
    let drawHeight = canvas.height;
    let offsetX = 0;
    let offsetY = 0;

    if (canvasRatio > videoRatio) {
        // Pillarbox (vertical bars)
        drawWidth = canvas.height * videoRatio;
        offsetX = (canvas.width - drawWidth) / 2;
    } else {
        // Letterbox (horizontal bars)
        drawHeight = canvas.width / videoRatio;
        offsetY = (canvas.height - drawHeight) / 2;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

    if (started && midiManager.notes.length > 0) {
        const currentTime = performance.now() / 1000;
        midiManager.drawVisualization(ctx, canvas.height, currentTime - midiManager.startTime);
    }
    ctx.restore();

    requestAnimationFrame(loop);
}

window.onload = initTrackmaker;
