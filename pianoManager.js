export class PianoManager {

    constructor(keypointManager) {
        this.keypointManager = keypointManager;

        this.key_number_dict = {
            2: 7, 3: 14, 4: 21, 5: 28, 6: 35, 7: 42
        };

        this.wkeys = [];
        this.bkeys = [];
        this.all_keys = [];

        this.middleCIndex = null;
        this.isCalibrated = false;

        this.overlay = document.getElementById("key-overlay");
    }

    initKeys() {
        this.initWKeys();
        this.middleCIndex = null;
        this.isCalibrated = false;
        this.bkeys = [];
        this.all_keys = [...this.wkeys];
        this.spawnMiddleCUI();
    }

    initWKeys() {
        const numWkeys = this.key_number_dict[this.keypointManager.keys.length] || 14;
        const keyWidth = this.keypointManager.scaled_width / numWkeys;

        this.wkeys = [];
        let currentX = 0;

        for (let i = 0; i < numWkeys; i++) {
            this.wkeys.push({
                index: i,
                x: currentX,
                width: keyWidth,
                signature: 0,
                isBlack: false
            });
            currentX += keyWidth;
        }
    }

    /* ==========================
       MIDDLE C SELECTOR - FIXED POSITIONING
    ========================== */
    spawnMiddleCUI() {
        if (!this.overlay) {
            console.error("key-overlay not found");
            return;
        }

        this.overlay.innerHTML = "";
        this.overlay.style.display = "block";

        const km = this.keypointManager;
        const numKeys = this.wkeys.length;
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        // Match exactly how the piano is drawn in the main loop
        const pianoW = km.scaled_width;
        const pianoH = km.scaled_height;

        const scaleX = canvas.width / pianoW;
        const scaleY = (canvas.height * 0.5) / pianoH;
        const scale = Math.min(scaleX, scaleY);

        const drawnWidth = pianoW * scale;
        const drawnHeight = pianoH * scale;

        const leftOffset = (canvas.width - drawnWidth) / 2;
        const topOffset = canvas.height * 0.5;

        const keyWidth = drawnWidth / numKeys;

        for (let i = 0; i < numKeys; i++) {
            const btn = document.createElement("button");
            btn.textContent = i.toString();
            btn.className = "piano-key-btn";

            btn.style.left = `${leftOffset + i * keyWidth}px`;
            btn.style.width = `${keyWidth}px`;
            btn.style.top = `${topOffset}px`;
            btn.style.height = `${drawnHeight * 0.65}px`;   // covers most of the key

            btn.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                console.log("Selected middle C white key index:", i);
                this.setMiddleC(i);
            });

            this.overlay.appendChild(btn);
        }
    }

    setMiddleC(index) {
        console.log("Middle C index =", index);

        this.middleCIndex = index;
        this.assignSignatures();
        this.initBKeys();
        this.isCalibrated = true;

        if (this.overlay) {
            this.overlay.innerHTML = "";
            this.overlay.style.display = "none";
        }

        // Enable MIDI and Start buttons
        document.getElementById('btnMIDI').disabled = false;
        document.getElementById('btnStart').disabled = false;

        document.getElementById('status').textContent = 
            `Middle C set to white key ${index} • Ready to load MIDI`;
    }

    assignSignatures() {
        const whiteOffsets = [0, 2, 4, 5, 7, 9, 11];

        for (let i = 0; i < this.wkeys.length; i++) {
            const relative = i - this.middleCIndex;
            const octave = Math.floor(relative / 7);
            let pos = relative % 7;
            if (pos < 0) pos += 7;

            const midi = 60 + octave * 12 + whiteOffsets[pos];
            this.wkeys[i].signature = midi;
        }
    }

    initBKeys() {
        this.bkeys = [];
        this.all_keys = [];

        const wkeyWidth = this.keypointManager.scaled_width / this.wkeys.length;

        for (let i = 0; i < this.wkeys.length; i++) {
            const white = this.wkeys[i];
            this.all_keys.push(white);

            const note = this.getNoteName(white.signature);
            const hasBlack = ["C","D","F","G","A"].includes(note);

            if (!hasBlack) continue;

            const black = {
                name: note + "#",
                signature: white.signature + 1,
                x: white.x + wkeyWidth * 0.72,
                width: wkeyWidth * 0.55,
                isBlack: true
            };

            this.bkeys.push(black);
            this.all_keys.push(black);
        }
    }

    getNoteName(signature) {
        const notes = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
        return notes[((signature % 12) + 12) % 12];
    }
}
