// GitReader — Spiral Layout + WebSocket Receiver
// Single bootstrap script. Attach to one SceneObject. Zero Inspector wiring needed.
// Per-line colorized git diff: green (+), red (-), cyan (@@), gray (context).

@component
export class SpiralLayout extends BaseScriptComponent {

  // --- Chunking ---
  readonly LINES_PER_PANEL = 50;

  // --- Spiral geometry (Archimedean: r = START_RADIUS + growthPerRad * theta) ---
  readonly START_RADIUS = 200;      // cm — distance to panel [0]
  readonly GROWTH_PER_TURN = 150;   // cm — radius increase per full 360°
  readonly ANGULAR_STEP_DEG = 30;   // degrees between panels (12 panels/revolution)
  readonly PANEL_Y = 0;             // cm — eye level

  // --- Text ---
  readonly FONT_SIZE = 48;
  readonly LINE_HEIGHT = 2;         // cm — vertical spacing between lines (tune this)
  readonly PANEL_WIDTH = 50;        // cm — worldSpaceRect half-width

  // --- WebSocket ---
  readonly SERVER_URL = 'ws://192.168.1.23:9876';

  private lineTexts: Text[][] = [];
  private internetModule: InternetModule = require('LensStudio:InternetModule');

  onAwake() {
    this.connectToMac();
  }

  // ==========================================
  // SPIRAL
  // ==========================================

  distributeText(fullText: string) {
    const lines = fullText.split('\n');
    const needed = Math.max(1, Math.ceil(lines.length / this.LINES_PER_PANEL));

    if (needed !== this.lineTexts.length) {
      this.clearPanels();
      this.buildSpiral(needed);
    }

    for (let i = 0; i < this.lineTexts.length; i++) {
      for (let j = 0; j < this.LINES_PER_PANEL; j++) {
        const lineIdx = i * this.LINES_PER_PANEL + j;
        const textComp = this.lineTexts[i][j];
        if (lineIdx < lines.length) {
          const line = lines[lineIdx];
          textComp.text = '│ ' + line;
          textComp.textFill.color = this.colorForLine(line);
        } else {
          textComp.text = '';
        }
      }
    }
  }

  private colorForLine(line: string): vec4 {
    if (line.startsWith('@@')) return new vec4(0.3, 0.8, 0.9, 1); // cyan  — hunk header
    if (line.startsWith('+'))  return new vec4(0.3, 0.9, 0.3, 1); // green — addition
    if (line.startsWith('-'))  return new vec4(0.9, 0.3, 0.3, 1); // red   — deletion
    return new vec4(0.85, 0.85, 0.85, 1);                         // gray  — context
  }

  private clearPanels() {
    const parent = this.getSceneObject();
    for (let i = parent.getChildrenCount() - 1; i >= 0; i--) {
      parent.getChild(i).destroy();
    }
    this.lineTexts = [];
  }

  private buildSpiral(count: number) {
    const parent = this.getSceneObject();
    const stepRad = this.ANGULAR_STEP_DEG * (Math.PI / 180);
    const growthPerRad = this.GROWTH_PER_TURN / (2 * Math.PI);
    const panelHeight = this.LINES_PER_PANEL * this.LINE_HEIGHT;

    for (let i = 0; i < count; i++) {
      const theta = i * stepRad;
      const r = this.START_RADIUS + growthPerRad * theta;

      const x = r * Math.sin(theta);
      const z = -r * Math.cos(theta);

      // Panel container — positioned on spiral
      const panelObj = global.scene.createSceneObject('Panel_' + i);
      panelObj.setParent(parent);
      panelObj.layer = parent.layer;

      const pt = panelObj.getTransform();
      pt.setLocalPosition(new vec3(x, this.PANEL_Y, z));

      const facingAngle = Math.atan2(x, z) + Math.PI;
      pt.setLocalRotation(quat.fromEulerAngles(0, facingAngle, 0));

      // One Text component per line
      const panelLines: Text[] = [];
      for (let j = 0; j < this.LINES_PER_PANEL; j++) {
        const lineObj = global.scene.createSceneObject('L_' + j);
        lineObj.setParent(panelObj);
        lineObj.layer = panelObj.layer;

        // Stack lines top-down within panel
        const yOffset = (panelHeight / 2) - j * this.LINE_HEIGHT;
        lineObj.getTransform().setLocalPosition(new vec3(0, yOffset, 0));

        const text = lineObj.createComponent('Component.Text') as Text;
        text.size = this.FONT_SIZE;
        text.horizontalAlignment = HorizontalAlignment.Left;
        text.verticalAlignment = VerticalAlignment.Top;
        text.horizontalOverflow = HorizontalOverflow.Overflow;
        text.worldSpaceRect = Rect.create(
          -this.PANEL_WIDTH, this.PANEL_WIDTH,
          -this.LINE_HEIGHT, 0
        );
        text.text = '';

        panelLines.push(text);
      }
      this.lineTexts.push(panelLines);
    }
  }

  // ==========================================
  // WEBSOCKET
  // ==========================================

  private connectToMac() {
    const ws = this.internetModule.createWebSocket(this.SERVER_URL);

    ws.onopen = () => {
      print('[GitReader] Connected to Mac server');
      ws.send('ready');
    };

    ws.onmessage = (event: WebSocketMessageEvent) => {
      if (typeof event.data === 'string') {
        print('[GitReader] Received ' + event.data.length + ' chars');
        this.distributeText(event.data);
      }
    };

    ws.onerror = () => print('[GitReader] WebSocket error');
    ws.onclose = () => print('[GitReader] WebSocket closed');
  }
}
