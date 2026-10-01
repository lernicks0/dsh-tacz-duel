import dev.dsh.tacz.AimMath;

public class AimMathTest {
    public static void main(String[] args) {
        if (AimMath.wrap(359) != -1) throw new AssertionError("Angle wrap");
        if (AimMath.approachYaw(179, -179, 1) != 180) throw new AssertionError("Shortest turn across wrap");
        if (AimMath.approachYaw(0, 180, 4) != -4) throw new AssertionError("Turn rate cap");
        if (AimMath.approachPitch(88, 100, 10) != 89) throw new AssertionError("Pitch cap");
        if (AimMath.yaw(1, 0) != -90) throw new AssertionError("Minecraft yaw convention");
        if (Math.abs(AimMath.pitch(0, 1, 1) + 45) > 0.01) throw new AssertionError("Pitch direction");
        System.out.println("PASS: angle wrap, shortest turn, bounded turning and Minecraft orientation.");
    }
}
