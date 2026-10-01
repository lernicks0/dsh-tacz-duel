package dev.dsh.tacz;

public final class AimMath {
    private AimMath() {}
    public static float wrap(float degrees) {
        float result = degrees % 360f;
        if (result >= 180f) result -= 360f;
        if (result < -180f) result += 360f;
        return result;
    }
    public static float approachYaw(float current, float desired, float limit) {
        return current + Math.max(-limit, Math.min(limit, wrap(desired - current)));
    }
    public static float approachPitch(float current, float desired, float limit) {
        return Math.max(-89f, Math.min(89f, current + Math.max(-limit, Math.min(limit, desired - current))));
    }
    public static float yaw(double dx, double dz) { return (float) Math.toDegrees(Math.atan2(-dx, dz)); }
    public static float pitch(double dx, double dy, double dz) { return (float) -Math.toDegrees(Math.atan2(dy, Math.hypot(dx, dz))); }
}
