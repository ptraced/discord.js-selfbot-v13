'use strict';

const process = require('node:process');
const { Collection } = require('@discordjs/collection');
const CachedManager = require('./CachedManager');
const { TypeError, Error } = require('../errors');
const GuildBan = require('../structures/GuildBan');
const { GuildMember } = require('../structures/GuildMember');

let deprecationEmittedForDays = false;

/**
 * Manages API methods for GuildBans and stores their cache.
 * @extends {CachedManager}
 */
class GuildBanManager extends CachedManager {
  constructor(guild, iterable) {
    super(guild.client, GuildBan, iterable);

    /**
     * The guild this Manager belongs to
     * @type {Guild}
     */
    this.guild = guild;
  }

  /**
   * The cache of this Manager
   * @type {Collection<Snowflake, GuildBan>}
   * @name GuildBanManager#cache
   */

  _add(data, cache) {
    return super._add(data, cache, { id: data.user.id, extras: [this.guild] });
  }

  /**
   * Data that resolves to give a GuildBan object. This can be:
   * * A GuildBan object
   * * A User resolvable
   * @typedef {GuildBan|UserResolvable} GuildBanResolvable
   */

  /**
   * Resolves a GuildBanResolvable to a GuildBan object.
   * @param {GuildBanResolvable} ban The ban that is in the guild
   * @returns {?GuildBan}
   */
  resolve(ban) {
    return super.resolve(ban) ?? super.resolve(this.client.users.resolveId(ban));
  }

  /**
   * Options used to fetch a single ban from a guild.
   * @typedef {BaseFetchOptions} FetchBanOptions
   * @property {UserResolvable} user The ban to fetch
   */

  /**
   * Options used to fetch multiple bans from a guild.
   * @typedef {Object} FetchBansOptions
   * @property {number} [limit] The maximum number of bans to return
   * @property {Snowflake} [before] Consider only bans before this id
   * @property {Snowflake} [after] Consider only bans after this id
   * @property {boolean} [cache] Whether to cache the fetched bans
   */

  /**
   * Fetches ban(s) from Discord.
   * @param {UserResolvable|FetchBanOptions|FetchBansOptions} [options] Options for fetching guild ban(s)
   * @returns {Promise<GuildBan|Collection<Snowflake, GuildBan>>}
   * @example
   * // Fetch multiple bans from a guild
   * guild.bans.fetch()
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch a maximum of 5 bans from a guild without caching
   * guild.bans.fetch({ limit: 5, cache: false })
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch a single ban
   * guild.bans.fetch('351871113346809860')
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch a single ban without checking cache
   * guild.bans.fetch({ user, force: true })
   *   .then(console.log)
   *   .catch(console.error)
   * @example
   * // Fetch a single ban without caching
   * guild.bans.fetch({ user, cache: false })
   *   .then(console.log)
   *   .catch(console.error);
   */
  async fetch(options) {
    if (!options) return this._fetchMany();
    const { user, cache, force, limit, before, after } = options;
    const resolvedUser = this.client.users.resolveId(user ?? options);
    if (resolvedUser) return this._fetchSingle({ user: resolvedUser, cache, force });

    if (!before && !after && !limit && typeof cache === 'undefined') {
      throw new Error('FETCH_BAN_RESOLVE_ID');
    }

    return this._fetchMany(options);
  }

  async _fetchSingle({ user, cache, force = false }) {
    if (!force) {
      const existing = this.cache.get(user);
      if (existing && !existing.partial) return existing;
    }

    const data = await this.client.api.guilds(this.guild.id).bans(user).get();
    return this._add(data, cache);
  }

  async _fetchMany(options = {}) {
    const data = await this.client.api.guilds(this.guild.id).bans.get({
      query: options,
    });

    return data.reduce((col, ban) => col.set(ban.user.id, this._add(ban, options.cache)), new Collection());
  }
  /**
   * Options used to ban a user from a guild.
   * @typedef {Object} BanOptions
   * @property {number} [days=0] Number of days of messages to delete, must be between 0 and 7, inclusive
   * <warn>This property is deprecated. Use `deleteMessageSeconds` instead.</warn>
   * @property {number} [deleteMessageSeconds] Number of seconds of messages to delete,
   * must be between 0 and 604800 (7 days), inclusive
   * @property {string} [reason] The reason for the ban
   */

  /**
   * Bans a user from the guild.
   * @param {UserResolvable} user The user to ban
   * @param {BanOptions} [options] Options for the ban
   * @returns {Promise<GuildMember|User|Snowflake>} Result object will be resolved as specifically as possible.
   * If the GuildMember cannot be resolved, the User will instead be attempted to be resolved. If that also cannot
   * be resolved, the user id will be the result.
   * @example
   * // Ban a user by id (or with a user/guild member object)
   * guild.bans.create('84484653687267328')
   *   .then(banInfo => console.log(`Banned ${banInfo.user?.tag ?? banInfo.tag ?? banInfo}`))
   *   .catch(console.error);
   */
  async create(user, options = {}) {
    if (typeof options !== 'object') throw new TypeError('INVALID_TYPE', 'options', 'object', true);
    const id = this.client.users.resolveId(user);
    if (!id) throw new Error('BAN_RESOLVE_ID', true);

    if (typeof options.days !== 'undefined' && !deprecationEmittedForDays) {
      process.emitWarning(
        'The days option for GuildBanManager#create() is deprecated. Use the deleteMessageSeconds option instead.',
        'DeprecationWarning',
      );

      deprecationEmittedForDays = true;
    }

    await this.client.api
      .guilds(this.guild.id)
      .bans(id)
      .put({
        data: {
          delete_message_seconds:
            typeof options.deleteMessageSeconds !== 'undefined'
              ? options.deleteMessageSeconds
              : (options.days ?? 0) * 24 * 60 * 60,
        },
        reason: options.reason,
      });
    if (user instanceof GuildMember) return user;
    const _user = this.client.users.cache.get(id);
    if (_user) {
      return this.guild.members.resolve(_user) ?? _user;
    }
    return id;
  }

  /**
   * Unbans a user from the guild.
   * @param {UserResolvable} user The user to unban
   * @param {string} [reason] Reason for unbanning user
   * @returns {Promise<?User>}
   * @example
   * // Unban a user by id (or with a user/guild member object)
   * guild.bans.remove('84484653687267328')
   *   .then(user => console.log(`Unbanned ${user.username} from ${guild.name}`))
   *   .catch(console.error);
   */
  async remove(user, reason) {
    const id = this.client.users.resolveId(user);
    if (!id) throw new Error('BAN_RESOLVE_ID');
    await this.client.api.guilds(this.guild.id).bans(id).delete({ reason });
    return this.client.users.resolve(user);
  }

  /**
   * Options used for bulk banning users from a guild.
   * @typedef {Object} BulkBanOptions
   * @property {number} [deleteMessageSeconds] Number of seconds of messages to delete,
   * must be between 0 and 604800 (7 days), inclusive
   * @property {string} [reason] The reason for the bans
   */

  /**
   * Result of bulk banning users from a guild.
   * @typedef {Object} BulkBanResult
   * @property {Snowflake[]} bannedUsers IDs of the banned users
   * @property {Snowflake[]} failedUsers IDs of the users that could not be banned or were already banned
   */

  /**
   * Bulk ban users from a guild, and optionally delete previous messages sent by them.
   * @param {Collection<Snowflake, UserResolvable>|UserResolvable[]} users The users to ban
   * @param {BulkBanOptions} [options] The options for bulk banning users
   * @returns {Promise<BulkBanResult>} Returns an object with `bannedUsers` key containing the IDs of the banned users
   * and the key `failedUsers` with the IDs that could not be banned or were already banned.
   * @example
   * // Bulk ban users by ids (or with user/guild member objects) and delete all their messages from the past 7 days
   * guild.bans.bulkCreate(['84484653687267328'], { deleteMessageSeconds: 7 * 24 * 60 * 60 })
   *   .then(result => {
   *     console.log(`Banned ${result.bannedUsers.length} users, failed to ban ${result.failedUsers.length} users.`)
   *   })
   *   .catch(console.error);
   * @deprecated This method will not be usable until an effective MFA implementation is in place.
   */
  async bulkCreate(users, options = {}) {
    if (!users || !(Array.isArray(users) || users instanceof Collection)) {
      throw new TypeError('INVALID_TYPE', 'users', 'Array or Collection of UserResolvable', true);
    }
    if (typeof options !== 'object') throw new TypeError('INVALID_TYPE', 'options', 'object', true);

    const userIds = users.map(user => this.client.users.resolveId(user));
    if (userIds.length === 0) throw new Error('BULK_BAN_USERS_OPTION_EMPTY');

    const result = await this.client.api.guilds(this.guild.id)['bulk-ban'].post({
      data: { delete_message_days: options.deleteMessageSeconds, user_ids: userIds },
      reason: options.reason,
    });
    return { bannedUsers: result.banned_users, failedUsers: result.failed_users };
  }
}

module.exports = GuildBanManager;
