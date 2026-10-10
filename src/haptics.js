// Small WebXR haptics helper. Quest exposes a pulse actuator on the input-source gamepad;
// vibrationActuator is kept as a fallback for browsers/controllers that use the newer shape.
export function pulseHaptics(state, intensity = 0.25, durationMs = 35) {
  const gamepad = state?.inputSource?.gamepad;
  if (!gamepad) return false;

  const strength = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0));
  const duration = Math.max(0, Math.min(250, Number.isFinite(durationMs) ? durationMs : 0));
  if (strength <= 0 || duration <= 0) return false;

  const actuator = gamepad.hapticActuators?.[0];
  if (actuator?.pulse) {
    try {
      const result = actuator.pulse(strength, duration);
      result?.catch?.(() => {});
      return true;
    } catch {
      // Fall through to vibrationActuator when available.
    }
  }

  const vibration = gamepad.vibrationActuator;
  if (vibration?.playEffect) {
    try {
      const result = vibration.playEffect('dual-rumble', {
        duration,
        strongMagnitude: strength,
        weakMagnitude: strength,
      });
      result?.catch?.(() => {});
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
