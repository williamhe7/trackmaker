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

const MODEL_URL = 'https://williamhe7.github.io/trackmaker/best_v3.onnx';

/* -------------------- INIT -------------------- */

async function initONNX() {
    updateStatus('Loading model...');
    try {
        session = await ort.InferenceSession.create(MODEL_URL, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'basic'
        });

        updateStatus('Model loaded');
        return true;
    } catch (e) {
        console.error(e);
        updateStatus('Model failed to load');
        return false;
    }
}

export async function initTrackmaker() {

    console.log("version 1.5");

    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () =>
        setTimeout(resizeCanvas, 200)
    );

    await initONNX();

    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180);

    setupUI();
    updateStatus('Ready');
}

/* -------------------- CANVAS -------------------- */

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

/* -------------------- UI -------------------- */

function setupUI() {
    document.getElementById('btnWebcam').onclick = startWebcam;
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnStart').onclick = startPlayback;
    document.getElementById('fullscreen-btn').onclick = toggleFullscreen;
}

function updateStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
}

/* -------------------- CAMERA -------------------- */

async function startWebcam() {

    const btn = document.getElementById('btnWebcam');
    if (btn) btn.disabled = true;

    try {

        updateStatus('Requesting Camera...');

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "user" },

                width: { exact: 1600 },
                height: { exact: 1200 },

                aspectRatio: { ideal: 4 / 3 },
                resizeMode: "none"
            }
        });

        const track = stream.getVideoTracks()[0];

        try {
            await track.applyConstraints({
                width: 1600,
                height: 1200,
                aspectRatio: 4 / 3
            });
        } catch (e) {
            console.log("applyConstraints ignored on iOS (normal)");
        }

        console.log("Camera stream acquired");

    } catch (e) {
        console.error(e);
        updateStatus('Camera failed');
        if (btn) btn.disabled = false;
        return;
    }

    video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;

    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");

    await video.play();

    isRunning = true;

    document.getElementById('btnCalibrate').disabled = false;

    updateStatus('Camera Active');

    loop();
}

/* -------------------- CALIBRATE -------------------- */

async function calibrate() {

    if (!video || !session) return;

    updateStatus('Calibrating...');

    const kps = await keypointManager.get_kpps(video, session);

    if (!kps || kps.length < 2) {
        updateStatus('Not enough keypoints');
        return;
    }

    keypointManager.keys = kps;
    keypointManager.compute_homography(kps);

    pianoManager.initKeys();

    isCalibrated = true;

    document.getElementById('btnMIDI').disabled = false;
    document.getElementById('btnStart').disabled = false;

    updateStatus(`Calibrated (${kps.length})`);
}

/* -------------------- MIDI -------------------- */

function selectMIDI() {

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mid,.midi";

    input.onchange = async (e) => {
        if (!e.target.files.length) return;

        await midiManager.loadMIDI(e.target.files[0]);

        updateStatus("MIDI loaded");
    };

    input.click();
}

/* -------------------- PLAYBACK -------------------- */

function startPlayback() {

    started = true;
    midiManager.startTime = performance.now() / 1000;

    updateStatus('Playback started');

    document.getElementById('btnWebcam')?.remove();
    document.getElementById('btnCalibrate')?.remove();
    document.getElementById('btnMIDI')?.remove();
    document.getElementById('btnStart')?.remove();
}

/* -------------------- FULLSCREEN -------------------- */

function toggleFullscreen() {

    const el = document.getElementById('canvas-container');

    if (!document.fullscreenElement) {
        el.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen();
    }
}

/* -------------------- MAIN LOOP -------------------- */

function loop() {

    if (!isRunning) return;

    requestAnimationFrame(loop);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (video && video.videoWidth > 0) {

        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // IMPORTANT FIX: prevents iOS zoom/crop drift
        const canvasAspect = canvas.width / canvas.height;
        const videoAspect = vw / vh;

        let drawW = canvas.width;
        let drawH = drawW / videoAspect;

        let offsetX = 0;
        let offsetY = (canvas.height - drawH) / 2;

        ctx.drawImage(
            video,
            offsetX,
            offsetY,
            drawW,
            drawH
        );
    }

    if (isCalibrated) {

        const pianoCanvas = keypointManager.transformImage(video);

        if (pianoCanvas) {

            const scaleX = canvas.width / pianoCanvas.width;
            const scaleY = (canvas.height * 0.5) / pianoCanvas.height;
            const scale = Math.min(scaleX, scaleY);

            const w = pianoCanvas.width * scale;
            const h = pianoCanvas.height * scale;

            ctx.drawImage(
                pianoCanvas,
                (canvas.width - w) / 2,
                canvas.height * 0.5,
                w,
                h
            );
        }
    }

    if (started && midiManager?.notes?.length) {

        const t = performance.now() / 1000;

        midiManager.drawVisualization(
            ctx,
            canvas.height,
            t - midiManager.startTime
        );
    }
}

window.onload = initTrackmaker;
