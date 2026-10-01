// Scroll-driven build sequence: pins a canvas and scrubs 83 frames as you scroll, cross-fading between
// neighbouring frames in proportion to how far the scroll is between them.
//
// The 83 frames are: 81 smoothly interpolated frames (images/sequence/001.webp–081.webp, an 8x RIFE
// interpolation of the original 11 board→box-closing shots) followed by 2 plain shots (images/12.webp,
// images/13.webp — the closed-box and final-lineup originals) shown as a hard cut rather than a dissolve.
// RIFE couldn't interpolate across the last two shots' big framing/lighting jump without visible ghosting,
// so that stretch keeps the older "snap to the nearest frame" behaviour instead of blending.
//
// MILESTONES marks where each of the 13 original shots ended up in this 83-frame sequence, so the caption
// and counter can still show "which of the 13 moments" regardless of how many interpolated frames sit
// between them. On the exploded burger (the HOLD milestone) the sequence holds for an extra stretch of
// scroll (--hold-viewports in css/style.css): a description panel fades in and the image floats gently
// (a CSS loop whose strength is set here).
(() => {
  const SEQUENCE_FRAMES = 81; // images/sequence/001.webp … 081.webp
  const FRAME_URLS = [
    ...Array.from({ length: SEQUENCE_FRAMES }, (_, i) => `images/sequence/${String(i + 1).padStart(3, '0')}.webp`),
    'images/12.webp',
    'images/13.webp',
  ];
  const FRAME_COUNT = FRAME_URLS.length; // 83
  const HARD_CUT_AFTER = new Set([SEQUENCE_FRAMES - 1, SEQUENCE_FRAMES]); // 0-based "from" index of the 2 hard-cut steps

  // 0-based position of each of the 13 original shots within the 83-frame sequence (8 interpolated frames
  // per original gap, i.e. positions 0, 8, 16, … 80, then the 2 hard-cut frames at 81 and 82).
  const MILESTONES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 81, 82];
  const HOLD_MOMENT = 8; // index into MILESTONES/LABELS for the exploded burger
  const HOLD = MILESTONES[HOLD_MOMENT];
  const STILL_MOMENT = 7; // "Lid on" — assembled burger, shown on its own when the visitor prefers reduced motion
  const PANEL_FADE_IN = 0.1; // share of the hold spent fading the panel in
  // Fades out over the first half of the dissolve from the hold milestone to the next one (raw frame-position units).
  const PANEL_FADE_OUT = (MILESTONES[HOLD_MOMENT + 1] - HOLD) / 2;
  const FLOAT_RAMP = 0.1; // share of the hold at each end spent easing the idle float in / out

  const LABELS = [
    'Empty board. Not for long.',
    'Toasted bun.',
    'Beef, straight off the grill.',
    'Cheese. Melted.',
    'Bacon.',
    'Lettuce and pickles. Still not a salad.',
    'Sauce. Plenty of it.',
    'Lid on.',
    'Here’s what’s in it.',
    'Into the box.',
    'Lid down.',
    'Sealed.',
    'Burger, fries, shake. Sorted.',
  ];

  const section = document.querySelector('.build');
  const sticky = section.querySelector('.build__sticky');
  const canvas = section.querySelector('.build__canvas');
  const ctx = canvas.getContext('2d');
  const countEl = section.querySelector('[data-build-count]');
  const labelEl = section.querySelector('[data-build-label]');
  const panelEl = section.querySelector('.build__panel');
  const stage = section.querySelector('.build__stage');

  // Decode every frame into an ImageBitmap up front so a scroll step never waits on a network fetch or an image decode.
  function loadFrame(url) {
    const img = new Image();
    img.src = url;
    return img.decode()
      .then(() => createImageBitmap(img))
      .catch(() => {
        console.warn(`Black Market: ${url} failed to load`);
        return null;
      });
  }

  function paint(frame, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    loadFrame(FRAME_URLS[MILESTONES[STILL_MOMENT]]).then((frame) => {
      if (frame) paint(frame);
      section.classList.add('is-ready');
    });
    return;
  }

  // The float glides only if @property registered --wave (it then reads "0"); unregistered, it would jump 0 ↔ 1, so skip it.
  const CAN_FLOAT = getComputedStyle(stage).getPropertyValue('--wave').trim() !== '';
  let frames = [];
  let lastPosition = -1;
  let lastPanel = -1;
  let lastFloat = -1;
  let momentIndex = -1;
  let pending = false;

  // position: 0 at frame 1 → FRAME_COUNT - 1 at the last frame; the fraction is how far we are towards the next frame.
  // It parks on the hold frame for the hold stretch, while hold runs 0 → 1 (hold is 0 before the stretch, 1 after).
  function scrollState() {
    const viewport = sticky.offsetHeight;
    const holdLength = viewport * (parseFloat(getComputedStyle(section).getPropertyValue('--hold-viewports')) || 0);
    const pinDistance = section.offsetHeight - viewport;
    const step = (pinDistance - holdLength) / (FRAME_COUNT - 1);
    const holdStart = HOLD * step;
    const scrolled = Math.min(Math.max(-section.getBoundingClientRect().top, 0), pinDistance);

    if (scrolled <= holdStart) return { position: scrolled / step, hold: 0 };
    if (scrolled < holdStart + holdLength) return { position: HOLD, hold: (scrolled - holdStart) / holdLength };
    return { position: Math.min(HOLD + (scrolled - holdStart - holdLength) / step, FRAME_COUNT - 1), hold: 1 };
  }

  function panelOpacity(position, hold) {
    if (position === HOLD) return Math.min(hold / PANEL_FADE_IN, 1);
    if (position > HOLD && position < HOLD + PANEL_FADE_OUT) return 1 - (position - HOLD) / PANEL_FADE_OUT;
    return 0;
  }

  // Full strength through the hold, eased to zero at both ends so the image is at rest when the loop starts and stops.
  function floatStrength(hold) {
    if (hold <= 0 || hold >= 1) return 0;
    return Math.min(hold / FLOAT_RAMP, (1 - hold) / FLOAT_RAMP, 1);
  }

  function nearestMomentIndex(position) {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < MILESTONES.length; i++) {
      const dist = Math.abs(position - MILESTONES[i]);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  }

  function drawPosition(position) {
    const index = Math.floor(position);
    const mix = position - index;
    const from = frames[index];
    const to = frames[index + 1];

    if (HARD_CUT_AFTER.has(index)) {
      // No dissolve through this step: show whichever end it's closer to, fully opaque.
      const active = mix < 0.5 ? from : to;
      if (active) paint(active);
    } else {
      // Current frame fully opaque, next frame over it at `mix`: the canvas shows from × (1 − mix) + to × mix.
      // (Drawing both at partial opacity instead would leave the canvas see-through mid-fade and dip it towards black.)
      if (from) paint(from);
      if (to && mix > 0) paint(to, from ? mix : 1);
    }

    // Caption follows whichever of the 13 original moments the position is closest to.
    const nearest = nearestMomentIndex(position);
    if (nearest !== momentIndex) {
      momentIndex = nearest;
      countEl.textContent = String(nearest + 1).padStart(2, '0');
      labelEl.textContent = LABELS[nearest];
    }
  }

  function render() {
    pending = false;
    const { position, hold } = scrollState();

    if (position !== lastPosition) {
      lastPosition = position;
      drawPosition(position);
    }

    const panel = panelOpacity(position, hold);
    if (panel !== lastPanel) {
      lastPanel = panel;
      panelEl.style.opacity = panel;
    }

    const float = CAN_FLOAT ? floatStrength(hold) : 0;
    if (float !== lastFloat) {
      lastFloat = float;
      stage.style.setProperty('--float', float);
      stage.classList.toggle('is-floating', float > 0); // only run the CSS loop while it can move anything
    }
  }

  function requestRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(render);
  }

  Promise.all(FRAME_URLS.map(loadFrame)).then((loaded) => {
    frames = loaded;
    section.classList.add('is-ready');
    render();
    window.addEventListener('scroll', requestRender, { passive: true });
    window.addEventListener('resize', requestRender);
  });
})();
