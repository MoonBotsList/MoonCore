import { Injectable } from '@nestjs/common'
import Axios, { AxiosInstance } from 'axios'
import _ from 'lodash'
import NodeCache from 'node-cache'
import { BotReport } from 'src/modules/users-bots/bots/dtos/report/bot-report'
import { WebhookTypes } from 'src/modules/users-bots/bots/enums/webhook.enums'
import { Bot } from 'src/modules/users-bots/bots/schemas/Bot.schema'
import { User } from 'src/modules/users-bots/users/schemas/User.schema'
import { avatarFormat } from 'src/utils/avatar-format'
import { discord } from '../../../config.json'
import { ReportPath } from '../report/interfaces/ReportPath'
import DiscordUser from './interfaces/DiscordUser'

@Injectable()
export class DiscordBotService {
  private readonly api: AxiosInstance
  private readonly baseUrl = 'https://discord.com/api/v8'
  private readonly botToken: string = discord.bot.token
  private readonly cache = new NodeCache()

  constructor () {
    this.api = Axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bot ' + this.botToken
      }
    })
  }

  async getUser (id: string): Promise<DiscordUser> {
    let user = this.cache.get<DiscordUser>(id)
    if (user === undefined) {
      user = (await this.api.get(`/users/${id}`)).data as DiscordUser
      this.cache.set(id, user, 3600)
    }
    return user
  }

  async getUserLogin (code: string): Promise<DiscordUser> {
    const params = new URLSearchParams()
    params.append('client_id', discord.app.id)
    params.append('client_secret', discord.app.secret)
    params.append('grant_type', 'authorization_code')
    params.append('scope', discord.app.scope)
    params.append('redirect_uri', discord.app.redirect)
    params.append('code', code)

    const { data: tokenUser } = await Axios.post('/oauth2/token', params.toString(), {
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    const { data: userDiscord } = await Axios.get('/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenUser.access_token as string}`
      },
      baseURL: this.baseUrl
    })

    return userDiscord as DiscordUser
  }

  async sendReport (botReport: BotReport, files: ReportPath[], bot: Bot, user: User): Promise<void> {
    const fields = [
      {
        name: 'Enviado por:',
        value: `${user.username}#${user.discriminator} (${user._id})`,
        inline: true
      },
      {
        name: 'Tópico:',
        value: botReport.topic,
        inline: true
      },
      {
        name: 'Motivo:',
        value: botReport.reason
      }
    ]

    if (!_.isEmpty(files)) {
      const url = discord.url.apiBaseUrl + `/bots/${bot._id}/reports/`

      fields.push({
        name: 'Arquivos',
        value: files.reduce((result, value) => result + `[Reporte-${value.id}](${url + value.fileName})\n`, '')
      })
    }

    const embed = {
      content: `<@&${discord.roles.admRole}>`,
      embed: {
        title: `Denúncia contra ${bot.username}#${bot.discriminator}`,
        color: 0xff0000,
        fields: fields,
        footer: {
          text: `ID: ${bot._id}`
        }
      }
    }

    await this.api.post(`/channels/${discord.channels.logReport}/messages`, embed)
  }

  async sendVote (user: User, bot: Bot): Promise<void> {
    try {
      await this.api.post(`/channels/${discord.channels.logVote}/messages`, {
        content: `${user.username}#${user.discriminator} (${user._id}) votou no bot \`${bot.username}#${bot.discriminator}\`\n` +
          `${discord.url.siteBaseUrl}/bots/${(bot.details.customURL !== null) ? bot.details.customURL : bot._id}`
      })
    } catch (error) {
      console.error(`${new Date().toISOString()} Falha ao enviar o log de voto`)
    }

    switch (bot.webhook.type) {
      case WebhookTypes.Discord: {
        if (bot.webhook.url != null) {
          const embed = {
            title: 'Voto no Zuraaa! List',
            description: `**${user.username}#${user.discriminator}** votou no bot **${bot.username}#${bot.discriminator}**`,
            color: 16777088,
            footer: {
              text: user._id
            },
            timestamp: new Date().toISOString(),
            thumbnail: {
              url: avatarFormat(user)
            }
          }

          try {
            await Axios.post(bot.webhook.url, {
              embeds: [
                embed
              ]
            })
          } catch (error) {
            console.error(`${new Date().toISOString()} Falha ao enviar o webhook para o discord`)
          }
        }
        break
      }

      case WebhookTypes.Server: {
        if (bot.webhook.url != null) {
          try {
            await Axios.post(bot.webhook.url, {
              type: 'vote',
              data: {
                user_id: user._id,
                bot_id: bot._id,
                votes: bot.votes.current
              }
            }, {
              headers: {
                Authorization: bot.webhook.authorization,
                'Content-Type': 'application/json'
              }
            })
          } catch (error) {
            console.error(`${new Date().toISOString()} Falha ao enviar o webhook para o servidor Code: ${error.message as string}`)
          }
        }
        break
      }

      default:
        break
    }
  }

  async banUser (user: User, author: User, reason: string): Promise<void> {
    const message = (_.isEmpty(reason)) ? 'Sem motivo informado.' : reason

    const embed = {
      content: `<@${discord.roles.admRole}>`,
      embed: {
        title: `${author.username}#${author.discriminator} baniu ${user.username}#${user.discriminator} (${user._id})`,
        description: `Motivo: \`${message}\``,
        color: 0xff0000
      }
    }

    await this.api.post(`/channels/${discord.channels.logBan}/messages`, embed)
  }

  async unbanUser (user: User, author: User): Promise<void> {
    const embed = {
      content: `<@${discord.roles.admRole}>`,
      embed: {
        title: `${author.username}#${author.discriminator} desbaniu ${user.username}#${user.discriminator} (${user._id})`,
        color: 0xff0000
      }
    }

    await this.api.post(`/channels/${discord.channels.logBan}/messages`, embed)
  }

  async removeTeste (botId: string): Promise<boolean> {
    try {
      await this.api.delete(`/guilds/${discord.guilds.teste}/members/${botId}`)
      return true
    } catch (error) {
      return false
    }
  }

  async approveBot (bot: Bot, user: User): Promise<void> {
    await this.removeTeste(bot._id)

    try {
      await this.api.post(`/channels/${discord.channels.logBotValidation}/messages`, {
        content: `<@${bot.owner as string}> O bot \`${bot.username}#${bot.discriminator}\` foi aprovado por \`${user.username}#${user.discriminator}\`\n` +
          `${discord.url.siteBaseUrl}/bots/${bot._id}`
      })
    } catch (error) {
      console.error(`${new Date().toISOString()} Falha ao enviar o log de validação do bot`)
    }

    try {
      const { data: { id } } = await this.api.post('/users/@me/channels', {
        recipient_id: bot.owner
      })

      await this.api.post(`/channels/${id as string}/messages`, {
        embed: {
          title: 'Sucesso',
          color: 0x7ED321,
          description: `O seu bot \`${bot.username}#${bot.discriminator}\` foi aprovado por \`${user.username}#${user.discriminator}\``
        }
      })
    } catch (error) {
      console.error(`${new Date().toISOString()} Falha ao enviar para o dono do bot que ele foi aprovado`)
    }

    try {
      await this.api.put(`/guilds/${discord.guilds.main}/members/${bot.owner as string}/roles/${discord.roles.developer}`)
    } catch (error) {

    }

    if (bot.details.otherOwners !== undefined) {
      for (let i = 0; i < bot.details.otherOwners.length; i++) {
        const owner = bot.details.otherOwners[i]
        try {
          await this.api.put(`/guilds/${discord.guilds.main}/members/${owner as string}/roles/${discord.roles.developer}`)
        } catch (error) {

        }
      }
    }
  }

  async reproveBot (bot: Bot, user: User, reason: string): Promise<void> {
    await this.removeTeste(bot._id)

    try {
      await this.api.post(`/channels/${discord.channels.logBotValidation}/messages`, {
        content: `<@${bot.owner as string}> O bot \`${bot.username}#${bot.discriminator}\` foi reprovado por \`${user.username}#${user.discriminator}\`\n` +
          `Motivo: ${(_.isEmpty(reason)) ? 'Motivo não informado' : reason}`
      })
    } catch (error) {

    }

    try {
      const { data: { id } } = await this.api.post('/users/@me/channels', {
        recipient_id: bot.owner
      })

      await this.api.post(`/channels/${id as string}/messages`, {
        embed: {
          title: 'Não foi dessa vez',
          color: 0xff0000,
          description: `O seu bot \`${bot.username}#${bot.discriminator}\` foi reprovado por \`${user.username}#${user.discriminator}\``,
          fields: [
            {
              name: 'Motivo:',
              value: (_.isEmpty(reason)) ? 'Motivo não informado' : reason
            }
          ],
          footer: {
            text: 'Você pode enviar o bot de novo quando tiver corrigido os os motivos dele ter sido rejeitado'
          }
        }
      })
    } catch (error) {

    }
  }

  async addBot (bot: Bot, user: User): Promise<void> {
    try {
      await this.api.post(`/channels/${discord.channels.logBotValidation}/messages`, {
        content: `\`${user.username}#${user.discriminator}\` enviou o bot **\`${bot.username}#${bot.discriminator}\`** (${bot._id}) para a aprovação. <@&${discord.roles.checker}>`
      })
    } catch (error) {
      console.error(`${new Date().toISOString()} Falha ao enviar a mensagem de bot enviado`)
    }

    try {
      const { data: { id } } = await this.api.post('/users/@me/channels', {
        recipient_id: bot.owner
      })

      await this.api.post(`/channels/${id as string}/messages`, {
        embed: {
          title: 'O seu bot foi enviado para aprovação',
          color: 0xfbff00,
          description: `O seu bot \`${bot.username}#${bot.discriminator}\` foi para a fila de aprovação`
        }
      })
    } catch (error) {
      console.error(`${new Date().toISOString()} Falha ao enviar a mensagem de bot enviado para o dono`)
    }
  }

  async updateBot (bot: Bot, user: User): Promise<void> {
    try {
      await this.api.post(`/channels/${discord.channels.logBotValidation}/messages`, {
        content: `\`${user.username}#${user.discriminator}\` editou o bot **\`${bot.username}#${bot.discriminator}\`** (${bot._id}) <@&${discord.roles.siteMod}>\n` +
                 `${discord.url.apiBaseUrl}/bots/${bot._id}\n` +
                 `${discord.url.siteBaseUrl}/bots/${bot._id}`
      })
    } catch (error) {
      console.error(`${new Date().toISOString()} Falha ao enviar a mensagem de bot editado`)
    }
  }
}
