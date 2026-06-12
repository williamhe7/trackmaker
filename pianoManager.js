export class PianoManager {

    constructor(keypointManager) {

        this.keypointManager = keypointManager;

        this.key_number_dict = {
            2: 7,
            3: 14,
            4: 21,
            5: 28,
            6: 35,
            7: 42
        };

        this.wkeys = [];
        this.bkeys = [];
        this.all_keys = [];

        this.middleCIndex = null;
        this.isCalibrated = false;

        this.overlay =
            document.getElementById("key-overlay");
    }

    /* ==========================
       MAIN ENTRY
    ========================== */

    initKeys() {

        this.initWKeys();

        this.middleCIndex = null;
        this.isCalibrated = false;

        this.bkeys = [];
        this.all_keys = [...this.wkeys];

        this.spawnMiddleCUI();
    }

    /* ==========================
       WHITE KEYS
    ========================== */

    initWKeys() {

        const numWkeys =
            this.key_number_dict[
                this.keypointManager.keys.length
            ] || 14;

        const keyWidth =
            this.keypointManager.scaled_width /
            numWkeys;

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
       MIDDLE C PICKER
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

        // Get the actual drawn piano area on screen
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        const keyWidthScreen = (km.scaled_width / numKeys) * this.getScaleFactor();
        const pianoLeft = this.getPianoLeftOffset();

        for (let i = 0; i < numKeys; i++) {
            const btn = document.createElement("button");
            btn.textContent = i;
            btn.className = "piano-key-btn";

            // Position exactly over the white key
            const left = pianoLeft + (i * keyWidthScreen);
            const width = keyWidthScreen;

            btn.style.left = `${left}px`;
            btn.style.width = `${width}px`;
            btn.style.bottom = "0px";           // align with bottom of piano area
            btn.style.height = "35%";           // cover lower part of keys

            btn.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                console.log("Selected middle C:", i);
                this.setMiddleC(i);
            });

            this.overlay.appendChild(btn);
        }
    }

    /* Helper methods */
    getScaleFactor() {
        const canvas = document.getElementById('canvas');
        if (!canvas || !this.keypointManager.scaled_width) return 1;

        const pianoCanvasWidth = this.keypointManager.scaled_width;
        const scaleX = canvas.width / pianoCanvasWidth;
        const scaleY = (canvas.height * 0.5) / this.keypointManager.scaled_height;

        return Math.min(scaleX, scaleY);
    }

    getPianoLeftOffset() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return 0;

        const km = this.keypointManager;
        const scale = this.getScaleFactor();
        const w = km.scaled_width * scale;

        return (canvas.width - w) / 2;   // centering offset
    }

    /* ==========================
       USER PICKED MIDDLE C
    ========================== */

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

        // === FIX: Enable the remaining buttons ===
        const btnMIDI = document.getElementById('btnMIDI');
        const btnStart = document.getElementById('btnStart');
        if (btnMIDI) btnMIDI.disabled = false;
        if (btnStart) btnStart.disabled = false;

        // Optional: better status
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = "Ready — Select MIDI to load a file";
    }

    /* ==========================
       SIGNATURE ASSIGNMENT
    ========================== */

    assignSignatures() {

        const whiteOffsets = [
            0, 2, 4, 5, 7, 9, 11
        ];

        for (
            let i = 0;
            i < this.wkeys.length;
            i++
        ) {

            const relative =
                i - this.middleCIndex;

            const octave =
                Math.floor(relative / 7);

            let pos =
                relative % 7;

            if (pos < 0) {
                pos += 7;
            }

            const midi =
                60 +
                octave * 12 +
                whiteOffsets[pos];

            this.wkeys[i].signature =
                midi;
        }
    }

    /* ==========================
       BLACK KEYS
    ========================== */

    initBKeys() {

        this.bkeys = [];
        this.all_keys = [];

        const wkeyWidth =
            this.keypointManager.scaled_width /
            this.wkeys.length;

        for (
            let i = 0;
            i < this.wkeys.length;
            i++
        ) {

            const white =
                this.wkeys[i];

            this.all_keys.push(
                white
            );

            const note =
                this.getNoteName(
                    white.signature
                );

            const hasBlack =
                note === "C" ||
                note === "D" ||
                note === "F" ||
                note === "G" ||
                note === "A";

            if (!hasBlack) {
                continue;
            }

            const black = {

                name:
                    note + "#",

                signature:
                    white.signature + 1,

                x:
                    white.x +
                    wkeyWidth * 0.72,

                width:
                    wkeyWidth * 0.55,

                isBlack:
                    true
            };

            this.bkeys.push(
                black
            );

            this.all_keys.push(
                black
            );
        }

        console.log(
            "White:",
            this.wkeys.length
        );

        console.log(
            "Black:",
            this.bkeys.length
        );

        console.log(
            "Total:",
            this.all_keys.length
        );
    }

    /* ==========================
       UTIL
    ========================== */

    getNoteName(signature) {

        const notes = [
            "C","C#","D","D#","E",
            "F","F#","G","G#",
            "A","A#","B"
        ];

        return notes[
            ((signature % 12) + 12) % 12
        ];
    }
}
