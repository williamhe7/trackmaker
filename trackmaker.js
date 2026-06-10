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

let loopStarted = false;
let frameCount = 0;

const MODEL_URL = "https://williamhe7.github.io/trackmaker/best_v3.onnx";

async function initONNX() {
    try {
        session = await ort.InferenceSession.create(MODEL_URL, {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "basic"
        });

        updateStatus("Model loaded");
        return true;
    } catch (e) {
        console.error(e);
        updateStatus("Model failed");
        return false;
    }
}

export async function initTrackmaker() {
    canvas = document.getElementById("canvas");
    ctx = canvas.getContext("2d");

    await initONNX();

    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180);

    setupUI();

    waitForCV();
}

function waitForCV() {
    if (typeof cv !== "undefined") return;
    setTimeout(waitForCV, 100);
}

function updateStatus(msg) {
    const el = document.getElementById("status");
    if (el) el.textContent = msg;
}

function setupUI() {
    document.getElementById("btnWebcam").onclick = startWebcam;
    document.getElementById("btnCalibrate").onclick = calibrate;
    document.getElementById("btnMIDI").onclick = selectMIDI;
    document.getElementById("btnStart").onclick = startPlayback;
}

async function startWebcam() {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });

    video = document.createElement("video");
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;

    await video.play();
    await new Promise(r => video.onloadedmetadata = r);

    resizeCanvas();

    isRunning = true;

    if (!loopStarted) {
        loopStarted = true;
        loop();
    }
}

function resizeCanvas() {
    const top = document.getElementById("top-bar");
    const h = top ? top.offsetHeight : 0;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - h;
}

async function calibrate() {
    const kps = await keypointManager.get_kpps(video, session);

    if (kps.length < 2) return;

    keypointManager.compute_homography(kps, keypointManager.h);
    pianoManager.initKeys();

    isCalibrated = true;
}

function selectMIDI() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mid,.midi";

    input.onchange = async e => {
        if (e.target.files[0]) {
            await midiManager.loadMIDI(e.target.files[0]);
        }
    };

    input.click();
}

function startPlayback() {
    started = true;
    midiManager.startTime = performance.now() / 1000;
}

function loop() {
    frameCount++;

    if (!isRunning) {
        requestAnimationFrame(loop);
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let pianoCanvas = null;

    if (isCalibrated && frameCount % 2 === 0) {
        pianoCanvas = keypointManager.transformImage(video);
    }

    if (pianoCanvas) {
        ctx.drawImage(
            pianoCanvas,
            (canvas.width - pianoCanvas.width) / 2,
            canvas.height - pianoCanvas.height
        );
    } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    if (started && midiManager.notes.length > 0) {
        const t = performance.now() / 1000;
        midiManager.drawVisualization(ctx, canvas.height, t - midiManager.startTime);
    }

    requestAnimationFrame(loop);
}

window.onload = initTrackmaker;
