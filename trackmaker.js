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
        console.error('ONNX Error:', e);
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
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = msg;
}

function setupUI() {
    document.getElementById('btnWebcam').onclick = startWebcam;
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnStart').onclick = startPlayback;
    document.getElementById('fullscreen-btn').onclick = toggleFullscreen;
}

async function startWebcam() {
    const btn = document.getElementById('btnWebcam');
    if (btn) btn.disabled = true;
    
    try {
        updateStatus('Requesting selfie camera...');

        // Strong preference for front/selfie camera
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: { 
                    exact: "user"      // Forces front/selfie camera
                },
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
        updateStatus('✅ Selfie Camera Active — Point at piano & tap Recalibrate');
        loop();
    } catch (e) {
        console.error('Camera Error:', e);
        
        // Fallback without "exact"
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "user" }
            });
            // ... (reuse video creation code)
            updateStatus('Selfie camera (fallback)');
            // Repeat the video setup here if needed
        } catch (fallbackErr) {
            updateStatus('❌ Could not access selfie camera');
        }
        if (btn) btn.disabled = false;
    }
}

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    const topBarHeight = document.getElementById('top-bar')?.offsetHeight || 140;
    canvas.height = window.innerHeight - topBarHeight - 10;
}

async function calibrate() {
    if (!video || !session) {
        updateStatus('Camera or model not ready');
        return;
    }
    updateStatus('Detecting keys...');
    
    try {
        const kps = await keypointManager.getKeypoints(video, session);
        if (kps?.length >= 2) {
            keypointManager.computeHomography(kps);
            pianoManager.initKeys();
            isCalibrated = true;
            document.getElementById('btnMIDI').disabled = false;
            document.getElementById('btnStart').disabled = false;
            updateStatus(`✅ Calibrated (${kps.length} groups)`);
        } else {
            updateStatus('⚠️ Not enough keys detected');
        }
    } catch (e) {
        console.error(e);
        updateStatus('Detection error');
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

function toggleFullscreen() {
    const container = document.getElementById('canvas-container');
    if (!document.fullscreenElement) {
        container.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

document.addEventListener('fullscreenchange', () => setTimeout(resizeCanvas, 100));

function loop() {
    if (!isRunning || !video) {
        requestAnimationFrame(loop);
        return;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const vW = video.videoWidth || 1280;
    const vH = video.videoHeight || 720;
    const ratio = vW / vH;

    let drawW = canvas.width;
    let drawH = drawW / ratio;
    let offsetY = (canvas.height - drawH) / 2;

    if (drawH > canvas.height) {
        drawH = canvas.height;
       
