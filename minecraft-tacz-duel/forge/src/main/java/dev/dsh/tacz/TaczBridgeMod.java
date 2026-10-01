package dev.dsh.tacz;

import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.fml.common.Mod;

@Mod("dsh_tacz_bridge")
public final class TaczBridgeMod {
    public TaczBridgeMod() {
        DistExecutor.safeRunWhenOn(Dist.CLIENT, () -> ClientBridge::install);
    }
}
