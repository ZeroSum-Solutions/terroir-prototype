import type { AuthUser, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AdminClient = SupabaseClient<Database>;
type CreateUserAttributes = Parameters<
  AdminClient["auth"]["admin"]["createUser"]
>[0];

export type TrackedLiveTestUser = {
  user: AuthUser;
  signupRestaurantId: string;
  signupWorkspaceId: string;
};

type PendingUser = {
  user: AuthUser;
  signupRestaurantId?: string;
  signupWorkspaceId?: string;
};

type CleanupOptions = {
  restaurantIds?: Iterable<string | null | undefined>;
};

const unique = (values: Iterable<string | null | undefined>) => [
  ...new Set(
    [...values].filter((value): value is string => Boolean(value)),
  ),
];

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LiveDbFixtureIdentityTracker {
  private readonly users = new Map<string, PendingUser>();

  async createUser(
    admin: AdminClient,
    attributes: CreateUserAttributes,
  ): Promise<TrackedLiveTestUser> {
    const { data, error } = await admin.auth.admin.createUser(attributes);
    if (error || !data.user) {
      throw error ?? new Error("live test user creation returned no user");
    }

    const pending: PendingUser = { user: data.user };
    this.users.set(data.user.id, pending);
    await this.captureSignupIdentity(admin, pending);

    return {
      user: pending.user,
      signupRestaurantId: pending.signupRestaurantId!,
      signupWorkspaceId: pending.signupWorkspaceId!,
    };
  }

  async cleanup(
    admin: AdminClient,
    options: CleanupOptions = {},
  ): Promise<void> {
    const failures: string[] = [];

    for (const pending of this.users.values()) {
      if (!pending.signupRestaurantId || !pending.signupWorkspaceId) {
        try {
          await this.captureSignupIdentity(admin, pending);
        } catch (error) {
          failures.push(
            `capture ${pending.user.id}: ${describeError(error)}`,
          );
        }
      }
    }

    const explicitRestaurantIds = unique(options.restaurantIds ?? []);
    const signupRestaurantIds = [...this.users.values()]
      .map((pending) => pending.signupRestaurantId)
      .filter((id): id is string => Boolean(id));
    const ownedRestaurantIds = unique([
      ...explicitRestaurantIds,
      ...signupRestaurantIds,
    ]);
    const ownedWorkspaceIds = unique([
      ...explicitRestaurantIds,
      ...[...this.users.values()]
        .map((pending) => pending.signupWorkspaceId)
        .filter((id): id is string => Boolean(id)),
    ]);

    if (ownedRestaurantIds.length > 0) {
      const { error } = await admin
        .from("restaurants")
        .delete()
        .in("id", ownedRestaurantIds);
      if (error) failures.push(`delete restaurants: ${error.message}`);
    }

    for (const pending of this.users.values()) {
      const { error } = await admin.auth.admin.deleteUser(pending.user.id);
      if (error) failures.push(`delete user ${pending.user.id}: ${error.message}`);
    }

    await this.removeOrphanedCapturedWorkspaces(
      admin,
      ownedWorkspaceIds,
      failures,
    );
    await this.verifyAbsent(
      admin,
      ownedRestaurantIds,
      ownedWorkspaceIds,
      failures,
    );

    if (failures.length > 0) {
      throw new Error(`live DB fixture cleanup failed:\n- ${failures.join("\n- ")}`);
    }
  }

  private async captureSignupIdentity(
    admin: AdminClient,
    pending: PendingUser,
  ): Promise<void> {
    const { data: membership, error: membershipError } = await admin
      .from("memberships")
      .select("restaurant_id")
      .eq("user_id", pending.user.id)
      .eq("role", "owner")
      .single();
    if (membershipError || !membership) {
      throw membershipError ?? new Error("signup membership was not created");
    }
    pending.signupRestaurantId = membership.restaurant_id;

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .select("workspace_id")
      .eq("id", membership.restaurant_id)
      .single();
    if (restaurantError || !restaurant) {
      throw restaurantError ?? new Error("signup restaurant was not created");
    }
    pending.signupWorkspaceId = restaurant.workspace_id;
  }

  private async removeOrphanedCapturedWorkspaces(
    admin: AdminClient,
    workspaceIds: string[],
    failures: string[],
  ): Promise<void> {
    if (workspaceIds.length === 0) return;

    const { data: remaining, error: remainingError } = await admin
      .from("workspaces")
      .select("id")
      .in("id", workspaceIds);
    if (remainingError) {
      failures.push(`read captured workspaces: ${remainingError.message}`);
      return;
    }
    const remainingIds = (remaining ?? []).map(({ id }) => id);
    if (remainingIds.length === 0) return;

    const [restaurants, memberships] = await Promise.all([
      admin
        .from("restaurants")
        .select("id,workspace_id")
        .in("workspace_id", remainingIds),
      admin
        .from("workspace_memberships")
        .select("id,workspace_id")
        .in("workspace_id", remainingIds),
    ]);
    if (restaurants.error) {
      failures.push(`read workspace restaurants: ${restaurants.error.message}`);
    }
    if (memberships.error) {
      failures.push(`read workspace memberships: ${memberships.error.message}`);
    }
    if (restaurants.error || memberships.error) return;
    if ((restaurants.data?.length ?? 0) > 0 || (memberships.data?.length ?? 0) > 0) {
      failures.push("captured workspace still has restaurant or membership references");
      return;
    }

    const { error } = await admin.from("workspaces").delete().in("id", remainingIds);
    if (error) failures.push(`delete captured workspaces: ${error.message}`);
  }

  private async verifyAbsent(
    admin: AdminClient,
    restaurantIds: string[],
    workspaceIds: string[],
    failures: string[],
  ): Promise<void> {
    if (restaurantIds.length > 0) {
      const { data, error } = await admin
        .from("restaurants")
        .select("id")
        .in("id", restaurantIds);
      if (error) failures.push(`verify restaurants: ${error.message}`);
      else if ((data?.length ?? 0) > 0) failures.push("owned restaurants remain");
    }
    if (workspaceIds.length > 0) {
      const { data, error } = await admin
        .from("workspaces")
        .select("id")
        .in("id", workspaceIds);
      if (error) failures.push(`verify workspaces: ${error.message}`);
      else if ((data?.length ?? 0) > 0) failures.push("owned workspaces remain");
    }

    for (const pending of this.users.values()) {
      const { data, error } = await admin.auth.admin.getUserById(pending.user.id);
      if (data.user) failures.push(`owned user remains: ${pending.user.id}`);
      else if (!error || error.status !== 404) {
        failures.push(
          `verify user ${pending.user.id}: expected 404, received ${error?.status ?? "no error"}`,
        );
      }
    }
  }
}
