;(function () {
  var ctx = null
  var masterGain = null
  var enabled = true
  var lastChime = 0
  var unlocked = false
  var BOOST = 2.4

  function hasAudio () {
    return typeof AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined'
  }

  function getContext () {
    if (ctx) return ctx
    var Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null
    try { ctx = new Ctor() } catch (e) { return null }
    masterGain = ctx.createGain()
    masterGain.gain.value = BOOST
    masterGain.connect(ctx.destination)
    return ctx
  }

  function ensureUnlocked () {
    if (!ctx) return
    if (ctx.state === 'running') return
    if (ctx.state === 'suspended') {
      try { void ctx.resume() } catch (e) {}
    }
  }

  function playTone (freq, startTime, attack, decay, peak, type) {
    if (!ctx) return
    var osc = ctx.createOscillator()
    osc.type = type || 'sine'
    osc.frequency.setValueAtTime(freq, startTime)
    var gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, startTime + 0.001)
    gain.gain.linearRampToValueAtTime(peak, startTime + attack)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + attack + decay)
    osc.connect(gain).connect(masterGain)
    osc.start(startTime)
    osc.stop(startTime + attack + decay + 0.05)
  }

  function playGlide (freqFrom, freqTo, glideTime, startTime, attack, decay, peak, type) {
    if (!ctx) return
    var osc = ctx.createOscillator()
    osc.type = type || 'sawtooth'
    osc.frequency.setValueAtTime(freqFrom, startTime)
    osc.frequency.exponentialRampToValueAtTime(freqTo, startTime + glideTime)
    var gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, startTime + 0.001)
    gain.gain.linearRampToValueAtTime(peak, startTime + attack)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + attack + decay)
    osc.connect(gain).connect(masterGain)
    osc.start(startTime)
    osc.stop(startTime + attack + decay + 0.05)
  }

  function playNoise (startTime, attack, decay, peak, filterFreq, Q) {
    if (!ctx) return
    var duration = attack + decay + 0.05
    var length = Math.max(1, Math.floor(duration * ctx.sampleRate))
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    var data = buffer.getChannelData(0)
    for (var i = 0; i < length; i++) data[i] = 2 * Math.random() - 1
    var source = ctx.createBufferSource()
    source.buffer = buffer
    var filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = filterFreq || 4000
    if (Q) filter.Q.value = Q
    var gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, startTime + 0.001)
    gain.gain.linearRampToValueAtTime(peak, startTime + attack)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + attack + decay)
    source.connect(filter).connect(gain).connect(masterGain)
    source.start(startTime)
    source.stop(startTime + duration)
  }

  var recipes = {
    click: function () {
      var now = ctx.currentTime
      playNoise(now, 0.001, 0.02, 0.35, 4000, 2)
    },
    success: function () {
      var now = ctx.currentTime
      playTone(660, now, 0.005, 0.15, 0.6, 'triangle')
      playTone(880, now + 0.10, 0.005, 0.25, 0.55, 'triangle')
    },
    chime: function () {
      var now = Date.now()
      if (now - lastChime < 3000) return
      lastChime = now
      var t = ctx.currentTime
      playTone(520, t, 0.01, 0.10, 0.55, 'sine')
      playTone(650, t + 0.07, 0.01, 0.12, 0.50, 'sine')
      playTone(780, t + 0.14, 0.01, 0.18, 0.45, 'sine')
    },
    error: function () {
      var now = ctx.currentTime
      playGlide(200, 120, 0.15, now, 0.01, 0.18, 0.5, 'sawtooth')
    },
    test: function () {
      var self = this
      var names = ['click', 'success', 'chime', 'error']
      names.forEach(function (n, i) {
        setTimeout(function () { self.play(n) }, i * 400)
      })
    }
  }

  window.Sonidos = {
    play: function (name) {
      if (!enabled) return
      if (!hasAudio()) return
      if (!getContext()) return
      ensureUnlocked()
      var fn = recipes[name]
      if (fn) fn.call(recipes)
    },
    setEnabled: function (v) { enabled = !!v },
    isEnabled: function () { return enabled },
    test: function () { recipes.test.call(recipes) }
  }

  function onFirstInteraction () {
    if (unlocked) return
    unlocked = true
    var events = ['pointerdown', 'keydown', 'touchstart']
    events.forEach(function (ev) {
      document.removeEventListener(ev, onFirstInteraction, true)
    })
    var ac = getContext()
    if (ac && ac.state === 'suspended') {
      try { void ac.resume() } catch (e) {}
    }
  }
  ;['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, onFirstInteraction, true)
  })

  document.addEventListener('pointerup', function (e) {
    if (typeof e.button === 'number' && e.button !== 0) return
    if (!(e.target instanceof Element)) return
    var btn = e.target.closest(
      'button, a[href], input[type="submit"], input[type="button"], input[type="reset"], [role="button"]'
    )
    if (!btn) return
    if (
      btn.matches('[disabled], [aria-disabled="true"], [data-no-sound]') ||
      btn.closest('[data-no-sound]')
    ) {
      return
    }
    window.Sonidos.play('click')
  }, true)
})()
