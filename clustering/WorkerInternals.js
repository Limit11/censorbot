const Request = require('../req')

const { internalPort } = require('../src/config')

const Collection = require('../util/Collection')

/**
 * Worker internal methods for brokering master internals
 */
class WorkerInternals {
  /**
   * Worker Internals
   * @param {Worker} worker Worker
   */
  constructor (worker) {
    /**
     * Worker
     * @type {Worker}
     */
    this.worker = worker

    /**
     * Guild fetch cache
     * @type {Collection.<Snowflake, CachedGuild>}
     */
    this.guildCache = new Collection()

    /**
     * Internal API
     * @type {Request}
     */
    this.api = Request(`http://localhost:${internalPort}`)
  }

  async event (event, data, resolve) {
    let guild
    let shard
    switch (event) {
      case 'GUILD_FETCH':
        guild = this.worker.client.guilds.get(data.id)
        resolve(guild ? {
          i: guild.id,
          n: guild.name,
          a: guild.icon,
          c: this.worker.client.channels.filter(x => x.guild_id === data.id)
            .map(x => {
              return {
                id: x.id,
                name: x.name
              }
            }),
          r: guild.roles
            .map(x => {
              return {
                id: x.id,
                name: x.name
              }
            })
        } : {})
        break
      case 'RELOAD_INTERNALS':
        delete require.cache[require.resolve('./WorkerInternals')]
        const WorkerInternals = require('./WorkerInternals') // eslint-disable-line no-case-declarations
        this.worker.internal = new WorkerInternals(this.worker)
        break
      case 'RELOAD':
        this.worker.client.reloader.reload(data.part)
        break
      case 'GUILD_COUNT':
        resolve(this.worker.client.internals.formatted)
        break
      case 'EVAL':
        try {
          const client = this.worker.client // eslint-disable-line
          let results = eval(data.ev) // eslint-disable-line
          if (results && results.then) results = await results
          resolve(results)
        } catch (err) {
          resolve('Error: ' + err.message)
        }
        break
      case 'CLUSTER_STATS':
        resolve({
          cluster: {
            memory: process.memoryUsage().heapUsed,
            uptime: process.uptime()
          },
          shards: this.worker.client.shards.map(shard => {
            return {
              id: shard.id,
              ping: shard.ping,
              connected: shard.connected,
              guilds: this.worker.client.guilds.filter(x => this.worker.client.guildShard(x.id) === shard.id).size
            }
          })
        })
        break
      case 'RESTART':
        shard = this.worker.client.shards.get(data.id)
        if (!shard) return
        if (data.destroy) return this.worker.client.killShard(data.id)
        shard.restart()
        break
      case 'PRESENCE':
        this.worker.client.presence[data]()
        break
      case 'ACTIVATE':
        this.worker.inactive = false
        break
      default:
        break
    }
  }

  /**
   * Fetch a guild
   * @param {Snowflake} id Guild ID
   * @return {CachedGuild} Guild
   */
  async fetchGuild (id) {
    const current = this.guildCache.get(id)
    if (current) return current

    const guild = await this.api
      .guilds[id]
      .get()

    if (!guild.i) return null

    this.guildCache.set(id, guild)

    setTimeout(() => {
      this.guildCache.delete(id)
    }, 120000)

    return guild
  }

  /**
   * Gets guild count
   * @param {Boolean} counted Whether to be a total of numbers
   * @returns {Array.<Array.<Number>>|Number}
   */
  async guildCount (counted) {
    const guilds = await this.api
      .guilds
      .get()

    return counted ? guilds.reduce((a, b) => a + b.reduce((c, d) => c + d, 0), 0) : guilds
  }

  /**
   * Cluster stats object
   * @typedef {Object} ClusterStats
   * @property {Object} cluster Cluster info
   * @property {Number} cluster.uptime Cluster uptime
   * @property {Number} cluster.memory Cluster memory usage
   * @property {Array.<ShardStats>} shards Array of shard info
   */

  /**
   * Shard stats object
   * @typedef {Object} ShardStats
   * @property {Number} id Shard ID
   * @property {Boolean} connected Whether the shard is connected
   * @property {Number} ping Shard WS ping
   * @property {Number} guilds Guilds on shard
   */

  /**
   * Shard stats
   * @returns {Array.<ClusterStats>}
   */
  shardStats () {
    return this.api
      .shards
      .get()
  }

  /**
   * Evaluated code on all shards
   * @param {String} ev String to evaluate
   * @returns {Array.<String>} Array of responses in order of cluster
   */
  eval (ev) {
    return this.api
      .clusters
      .post({
        body: { ev }
      })
  }

  /**
   * Reloads a part on all clusters
   * @param {String} part Reloadable part
   */
  reload (part) {
    this.api
      .reload[part]
      .post()
  }

  /**
   * Restart a shard
   * @param {Number} id Shard ID
   * @param {Boolean} destroy Whether to kill
   */
  restart (id, destroy) {
    this.api
      .shards[id]
      .delete({
        query: destroy ? {
          d: true
        } : {}
      })
  }

  /**
   * Kill and restart an entire cluster
   * @param {Number} id Cluster ID
   */
  killCluster (id) {
    this.api
      .clusters[id]
      .delete()
  }

  /**
   * Reload cluster internal components
   */
  reloadInternals () {
    this.api
      .reload
      .post()
  }

  restartDashboard () {
    this.api
      .dash
      .delete()
  }

  /**
   * Sets a presence on all shards
   * @param {String} presence Presence name
   */
  setPresence (presence) {
    this.api
      .presence[presence]
      .put()
  }

  /**
   * Creates a HelpME package
   * @param {Snowflake} id Guild ID
   * @param {String} name Guild Name
   * @param {Snowflake} owner Owner ID
   * @returns {SmallID}
   */
  async createHelpMe (id, name, owner) {
    const res = await this.api
      .helpme
      .post({
        body: { id, name, owner }
      })

    if (res.error) return null

    return res.hm
  }

  /**
   * Retrieves a packaged HelpME package
   * @param {SmallID} hm HelpME code
   */
  getHelpMe (hm) {
    return this.api
      .helpme[hm]
      .get()
  }
}

module.exports = WorkerInternals
