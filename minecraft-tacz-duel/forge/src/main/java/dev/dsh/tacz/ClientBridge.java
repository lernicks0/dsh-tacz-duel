package dev.dsh.tacz;

import com.google.gson.*;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.tacz.guns.api.TimelessAPI;
import com.tacz.guns.api.client.gameplay.IClientPlayerGunOperator;
import com.tacz.guns.api.entity.IGunOperator;
import com.tacz.guns.api.entity.ShootResult;
import com.tacz.guns.api.item.IGun;
import com.tacz.guns.resource.pojo.data.gun.GunData;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ServerboundMovePlayerPacket;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.ModList;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.concurrent.*;

public final class ClientBridge {
    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private static final Minecraft MC = Minecraft.getInstance();
    private final String token;
    private HttpServer server;
    private boolean armed;
    private String opponent = "";
    private JsonObject intent = new JsonObject();
    private long leaseUntil;
    private long duelUntil;
    private long shotsAccepted;
    private long stoppedCount;
    private String lastShot = "NONE";
    private String stopReason = "Not armed";
    private boolean oldPause;
    private boolean pauseChanged;
    private Player previousOpponent;
    private boolean opponentWasAlive;
    private long opponentDeathsObserved;

    private ClientBridge() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        token = HexFormat.of().formatHex(bytes);
    }
    public static void install() {
        ClientBridge bridge = new ClientBridge();
        MinecraftForge.EVENT_BUS.register(bridge);
        try { bridge.startHttp(); }
        catch (Exception error) { System.err.println("DSH TACZ bridge failed: " + error); }
    }
    private void startHttp() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 16);
        server.setExecutor(Executors.newFixedThreadPool(2, task -> { Thread thread = new Thread(task, "DSH-TACZ-HTTP"); thread.setDaemon(true); return thread; }));
        server.createContext("/call", this::handle);
        server.start();
        Path folder = MC.gameDirectory.toPath().resolve("config/dsh-tacz-bridge");
        Files.createDirectories(folder);
        JsonObject session = new JsonObject();
        session.addProperty("port", server.getAddress().getPort());
        session.addProperty("token", token);
        session.addProperty("pid", ProcessHandle.current().pid());
        session.addProperty("bridge", "dsh-tacz-bridge");
        session.addProperty("version", "0.1.0");
        Files.writeString(folder.resolve("session.json"), GSON.toJson(session), StandardCharsets.UTF_8);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(0);
            try {
                Path file = folder.resolve("session.json");
                if (Files.exists(file) && Files.readString(file).contains(token)) Files.delete(file);
            } catch (IOException ignored) {}
        }, "DSH-TACZ-shutdown"));
        System.out.println("DSH TACZ bridge ready: " + folder.resolve("session.json"));
    }
    private void handle(HttpExchange exchange) throws IOException {
        String supplied = exchange.getRequestHeaders().getFirst("Authorization");
        boolean valid = supplied != null && MessageDigest.isEqual(supplied.getBytes(StandardCharsets.UTF_8), ("Bearer " + token).getBytes(StandardCharsets.UTF_8));
        if (!valid || exchange.getRequestHeaders().containsKey("Origin")) { respond(exchange, 401, failure("Unauthorized local request")); return; }
        if (!exchange.getRequestMethod().equals("POST") || !exchange.getRequestURI().getPath().equals("/call")) { respond(exchange, 404, failure("Use POST /call")); return; }
        String type = exchange.getRequestHeaders().getFirst("Content-Type");
        if (type == null || !type.startsWith("application/json")) { respond(exchange, 400, failure("JSON request required")); return; }
        byte[] bytes = exchange.getRequestBody().readNBytes(32769);
        if (bytes.length > 32768) { respond(exchange, 413, failure("Request too large")); return; }
        try {
            JsonObject request = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
            CompletableFuture<JsonObject> pending = new CompletableFuture<>();
            long expires = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
            MC.execute(() -> {
                if (pending.isCancelled() || System.nanoTime() > expires) return;
                try {
                    JsonObject result = new JsonObject();
                    result.addProperty("ok", true);
                    result.add("value", command(request));
                    pending.complete(result);
                } catch (Exception error) { pending.completeExceptionally(error); }
            });
            try { respond(exchange, 200, pending.get(3, TimeUnit.SECONDS)); }
            catch (TimeoutException error) { pending.cancel(false); respond(exchange, 503, failure("Client tick unavailable; no queued command will execute later")); }
        } catch (Exception error) {
            Throwable cause = error.getCause() == null ? error : error.getCause();
            respond(exchange, 400, failure(cause.getMessage()));
        }
    }
    private static JsonObject failure(String message) { JsonObject result = new JsonObject(); result.addProperty("ok", false); result.addProperty("error", message); return result; }
    private static void respond(HttpExchange exchange, int status, JsonObject result) throws IOException {
        byte[] bytes = GSON.toJson(result).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) { output.write(bytes); }
    }
    private JsonElement command(JsonObject request) {
        String action = request.get("action").getAsString();
        JsonObject a = request.has("args") ? request.getAsJsonObject("args") : new JsonObject();
        if (action.equals("observe")) return observe();
        if (action.equals("stop")) { stop("User stop"); return observe(); }
        LocalPlayer player = MC.player;
        if (player == null || MC.level == null) throw new IllegalStateException("Join the duel server with the bot client first");
        if (action.equals("catalog")) return catalog();
        if (action.equals("arm")) {
            if (MC.screen != null || player.isDeadOrDying()) throw new IllegalStateException("Close menus and make the bot alive before arming");
            String name = a.get("opponent").getAsString();
            if (!name.matches("[A-Za-z0-9_]{1,16}") || name.equalsIgnoreCase(player.getGameProfile().getName())) throw new IllegalArgumentException("Use the other player's exact Minecraft nickname");
            int seconds = (int) number(a, "seconds", 180, 10, 600);
            stop("New duel");
            opponent = name;
            armed = true;
            duelUntil = System.currentTimeMillis() + seconds * 1000L;
            oldPause = MC.options.pauseOnLostFocus;
            MC.options.pauseOnLostFocus = false;
            pauseChanged = true;
            shotsAccepted = 0;
            opponentDeathsObserved = 0;
            previousOpponent = null;
            opponentWasAlive = false;
            stopReason = "";
            return observe();
        }
        if (!armed) throw new IllegalStateException("Arm a bounded duel against the named opponent first");
        switch (action) {
            case "frame" -> {
                number(a, "yaw", player.getYRot(), -100000, 100000);
                number(a, "pitch", player.getXRot(), -89, 89);
                number(a, "turnRate", 4, 0.25, 12);
                int lease = (int) number(a, "leaseMs", 400, 100, 600);
                // Validate types before taking ownership of a complete new intent.
                for (String key : new String[]{"forward", "back", "left", "right", "sneak", "aim", "shoot"}) flag(a, key);
                intent = a.deepCopy();
                leaseUntil = System.currentTimeMillis() + lease;
                return observe();
            }
            case "reload" -> { IClientPlayerGunOperator.fromLocalPlayer(player).reload(); return observe(); }
            case "bolt" -> { IClientPlayerGunOperator.fromLocalPlayer(player).bolt(); return observe(); }
            case "fire-select" -> { IClientPlayerGunOperator.fromLocalPlayer(player).fireSelect(); return observe(); }
            case "slot" -> {
                int slot = (int) number(a, "slot", 1, 1, 9);
                if (slot != number(a, "slot", 1, 1, 9)) throw new IllegalArgumentException("slot must be integer");
                player.getInventory().selected = slot - 1;
                return observe();
            }
            default -> throw new IllegalArgumentException("Unknown action: " + action);
        }
    }
    private static double number(JsonObject a, String key, double fallback, double min, double max) {
        if (!a.has(key)) return fallback;
        if (!a.get(key).isJsonPrimitive() || !a.get(key).getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException(key + " must be numeric");
        double value = a.get(key).getAsDouble();
        if (!Double.isFinite(value) || value < min || value > max) throw new IllegalArgumentException(key + " out of range");
        return value;
    }
    private static boolean flag(JsonObject a, String key) {
        if (!a.has(key)) return false;
        if (!a.get(key).isJsonPrimitive() || !a.get(key).getAsJsonPrimitive().isBoolean()) throw new IllegalArgumentException(key + " must be boolean");
        return a.get(key).getAsBoolean();
    }
    private void release() {
        MC.options.keyUp.setDown(false); MC.options.keyDown.setDown(false);
        MC.options.keyLeft.setDown(false); MC.options.keyRight.setDown(false);
        MC.options.keyJump.setDown(false); MC.options.keyShift.setDown(false); MC.options.keySprint.setDown(false);
        if (MC.player != null && IGun.mainHandHoldGun(MC.player)) {
            var operator = IClientPlayerGunOperator.fromLocalPlayer(MC.player);
            if (operator.isAim()) operator.aim(false);
        }
    }
    private void stop(String reason) {
        if (armed) { release(); stoppedCount++; }
        armed = false;
        leaseUntil = 0;
        intent = new JsonObject();
        stopReason = reason;
        if (pauseChanged) { MC.options.pauseOnLostFocus = oldPause; pauseChanged = false; }
    }
    @SubscribeEvent
    public void tick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.START || !armed) return;
        LocalPlayer player = MC.player;
        if (player == null || MC.level == null || player.isDeadOrDying() || MC.screen != null) { stop("Bot dead, disconnected or menu opened"); return; }
        long now = System.currentTimeMillis();
        if (now >= duelUntil) { stop("Duel duration reached"); return; }
        if (now >= leaseUntil) { release(); return; }
        Player target = visibleOpponent();
        if (target != null) {
            if (target != previousOpponent) { previousOpponent = target; opponentWasAlive = !target.isDeadOrDying(); }
            if (opponentWasAlive && target.isDeadOrDying()) { opponentDeathsObserved++; stop("Observed opponent death"); return; }
        }
        float turnRate = (float) number(intent, "turnRate", 4, 0.25, 12);
        player.setYRot(AimMath.approachYaw(player.getYRot(), (float) number(intent, "yaw", player.getYRot(), -100000, 100000), turnRate));
        player.setXRot(AimMath.approachPitch(player.getXRot(), (float) number(intent, "pitch", player.getXRot(), -89, 89), turnRate));
        boolean forward = flag(intent, "forward") && safeStep(1, 0);
        boolean back = flag(intent, "back") && safeStep(-1, 0);
        boolean left = flag(intent, "left") && safeStep(0, 1);
        boolean right = flag(intent, "right") && safeStep(0, -1);
        MC.options.keyUp.setDown(forward); MC.options.keyDown.setDown(back);
        MC.options.keyLeft.setDown(left); MC.options.keyRight.setDown(right);
        MC.options.keyShift.setDown(flag(intent, "sneak")); MC.options.keySprint.setDown(false);
        if (!IGun.mainHandHoldGun(player)) return;
        IClientPlayerGunOperator operator = IClientPlayerGunOperator.fromLocalPlayer(player);
        boolean aim = flag(intent, "aim");
        if (operator.isAim() != aim) operator.aim(aim);
        if (!flag(intent, "shoot") || target == null || target.isDeadOrDying() || !safeShot(target)) return;
        // Synchronize the normal player orientation before the TACZ shot packet.
        if (MC.getConnection() != null) MC.getConnection().send(new ServerboundMovePlayerPacket.Rot(player.getYRot(), player.getXRot(), player.onGround()));
        ShootResult result = operator.shoot();
        lastShot = result.name();
        if (result == ShootResult.SUCCESS) shotsAccepted++;
    }
    private boolean safeStep(double forward, double left) {
        LocalPlayer p = MC.player;
        double yaw = Math.toRadians(p.getYRot());
        Vec3 shift = new Vec3(-Math.sin(yaw) * forward + Math.cos(yaw) * left, 0, Math.cos(yaw) * forward + Math.sin(yaw) * left).scale(0.7);
        BlockPos floor = BlockPos.containing(p.position().add(shift).add(0, -0.2, 0));
        var block = p.level().getBlockState(floor);
        if (block.isAir() || block.is(Blocks.LAVA) || block.is(Blocks.FIRE) || block.is(Blocks.MAGMA_BLOCK) || block.is(Blocks.CAMPFIRE)) return false;
        return p.level().noCollision(p, p.getBoundingBox().move(shift));
    }
    private Player visibleOpponent() {
        if (MC.player == null || MC.level == null) return null;
        return MC.level.players().stream().filter(p -> p != MC.player && p.getGameProfile().getName().equalsIgnoreCase(opponent))
            .filter(p -> !p.isSpectator() && !p.isInvisibleTo(MC.player) && p.distanceTo(MC.player) <= 64 && MC.player.hasLineOfSight(p))
            .filter(p -> Math.abs(AimMath.wrap(AimMath.yaw(p.getX() - MC.player.getX(), p.getZ() - MC.player.getZ()) - MC.player.getYRot())) <= 70)
            .findFirst().orElse(null);
    }
    private boolean safeShot(Player target) {
        LocalPlayer p = MC.player;
        Vec3 chest = target.position().add(0, target.getBbHeight() * 0.65, 0);
        Vec3 difference = chest.subtract(p.getEyePosition());
        if (Math.abs(AimMath.wrap(AimMath.yaw(difference.x, difference.z) - p.getYRot())) > 8 || Math.abs(AimMath.pitch(difference.x, difference.y, difference.z) - p.getXRot()) > 8) return false;
        Vec3 start = p.getEyePosition();
        Vec3 end = start.add(p.getViewVector(1).scale(difference.length() + 1));
        HitResult block = p.level().clip(new ClipContext(start, end, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, p));
        if (block.getType() != HitResult.Type.MISS && block.getLocation().distanceTo(start) < difference.length() - 0.5) return false;
        // Suppress shots when another player would be in the foreground.
        for (Player other : MC.level.players()) {
            if (other == p || other == target || other.isSpectator()) continue;
            var hit = other.getBoundingBox().inflate(0.1).clip(start, end);
            if (hit.isPresent() && hit.get().distanceTo(start) < difference.length()) return false;
        }
        return true;
    }
    private JsonObject observe() {
        JsonObject result = new JsonObject();
        result.addProperty("bridge", "dsh-tacz-bridge"); result.addProperty("version", "0.1.0");
        result.addProperty("minecraft", "1.20.1");
        result.addProperty("tacz", ModList.get().getModContainerById("tacz").map(c -> c.getModInfo().getVersion().toString()).orElse("missing"));
        result.addProperty("armed", armed); result.addProperty("opponent", opponent);
        result.addProperty("stopReason", stopReason); result.addProperty("shotsAccepted", shotsAccepted);
        result.addProperty("opponentDeathsObserved", opponentDeathsObserved); result.addProperty("lastShotResult", lastShot);
        result.addProperty("leaseActive", armed && System.currentTimeMillis() < leaseUntil);
        result.addProperty("menuOpen", MC.screen != null);
        LocalPlayer p = MC.player;
        if (p == null || MC.level == null) { result.addProperty("state", "not-in-world"); return result; }
        result.addProperty("state", p.isDeadOrDying() ? "dead" : "ready");
        result.addProperty("username", p.getGameProfile().getName()); result.addProperty("health", p.getHealth());
        result.addProperty("food", p.getFoodData().getFoodLevel()); result.add("position", vector(p.position()));
        result.add("eye", vector(p.getEyePosition())); result.addProperty("yaw", p.getYRot()); result.addProperty("pitch", p.getXRot());
        result.addProperty("dimension", p.level().dimension().location().toString());
        JsonArray hotbar = new JsonArray();
        for (int i = 0; i < 9; i++) {
            var stack = p.getInventory().getItem(i);
            JsonObject item = new JsonObject(); item.addProperty("slot", i + 1);
            item.addProperty("item", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString()); item.addProperty("count", stack.getCount());
            IGun gun = IGun.getIGunOrNull(stack);
            if (gun != null) { item.addProperty("gunId", gun.getGunId(stack).toString()); item.addProperty("ammo", gun.getCurrentAmmoCount(stack)); }
            hotbar.add(item);
        }
        result.add("hotbar", hotbar); result.addProperty("slot", p.getInventory().selected + 1);
        var stack = p.getMainHandItem(); IGun gun = IGun.getIGunOrNull(stack);
        if (gun != null) {
            JsonObject held = new JsonObject(); held.addProperty("gunId", gun.getGunId(stack).toString());
            held.addProperty("ammo", gun.getCurrentAmmoCount(stack)); held.addProperty("chambered", gun.hasBulletInBarrel(stack));
            held.addProperty("inventoryAmmo", gun.useInventoryAmmo(stack)); held.addProperty("canReload", gun.hasInventoryAmmo(p, stack, true));
            held.addProperty("rpm", gun.getRPM(stack)); held.addProperty("fireMode", gun.getFireMode(stack).name());
            IGunOperator sync = IGunOperator.fromLivingEntity(p);
            held.addProperty("reloading", sync.getSynReloadState().getStateType().isReloading());
            held.addProperty("bolting", sync.getSynIsBolting()); held.addProperty("drawing", sync.getSynDrawCoolDown() != 0);
            held.addProperty("aiming", IClientPlayerGunOperator.fromLocalPlayer(p).isAim());
            held.addProperty("shootCooldownMs", IClientPlayerGunOperator.fromLocalPlayer(p).getClientShootCoolDown());
            TimelessAPI.getClientGunIndex(gun.getGunId(stack)).ifPresent(index -> held.add("data", GSON.toJsonTree(index.getGunData())));
            result.add("gun", held);
        } else result.add("gun", JsonNull.INSTANCE);
        Player target = visibleOpponent();
        if (target != null) {
            JsonObject visible = new JsonObject(); visible.addProperty("username", target.getGameProfile().getName());
            visible.add("position", vector(target.position())); visible.add("aimPoint", vector(target.position().add(0, target.getBbHeight() * 0.65, 0)));
            visible.addProperty("distance", target.distanceTo(p)); visible.addProperty("dead", target.isDeadOrDying());
            result.add("visibleOpponent", visible);
        } else result.add("visibleOpponent", JsonNull.INSTANCE);
        return result;
    }
    private JsonArray catalog() {
        JsonArray result = new JsonArray();
        TimelessAPI.getAllClientGunIndex().forEach(entry -> {
            JsonObject record = new JsonObject(); record.addProperty("gunId", entry.getKey().toString());
            record.addProperty("type", entry.getValue().getType());
            record.addProperty("name", Component.translatable(entry.getValue().getName()).getString());
            GunData data = entry.getValue().getGunData(); record.add("data", GSON.toJsonTree(data));
            result.add(record);
        });
        return result;
    }
    private static JsonObject vector(Vec3 p) { JsonObject result = new JsonObject(); result.addProperty("x", p.x); result.addProperty("y", p.y); result.addProperty("z", p.z); return result; }
}
