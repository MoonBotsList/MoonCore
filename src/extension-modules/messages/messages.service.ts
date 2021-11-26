import { Injectable, OnModuleInit } from '@nestjs/common'
import { Channel, connect, Connection } from 'amqplib'
import { v4 as uuid } from 'uuid'
import DiscordUser from './interfaces/discord-user'
import { rabbit } from '../../../config.json'
import NodeCache from 'node-cache'
import { Bot } from 'src/modules/users-bots/bots/schemas/Bot.schema'
import { User } from 'src/modules/users-bots/users/schemas/User.schema'

@Injectable()
export class MessageService implements OnModuleInit {
  connection?: Connection
  channel?: Channel
  cache = new NodeCache()

  async onModuleInit (): Promise<void> {
    this.connection = await connect(rabbit.url)
    this.channel = await this.connection.createChannel()
  }

  async send (buffer: string, queue: string): Promise<string> {
    const assert = await this.channel?.assertQueue('', {
      exclusive: true
    })
    return await new Promise((resolve, reject) => {
      if (assert !== undefined) {
        const id = uuid()

        this.channel?.consume(assert.queue, msg => {
          if (msg !== null) {
            if (msg.properties.correlationId === id) {
              resolve(msg.content.toString())
            } else {
              reject(new Error('Uuid not match'))
            }
          } else {
            reject(new Error('Message null'))
          }
        }, {
          noAck: true
        }).catch(reject)

        this.channel?.sendToQueue(queue, Buffer.from(buffer), {
          correlationId: id,
          replyTo: assert?.queue
        })

        setTimeout(() => {
          reject(new Error('falhou no tempo'))
        }, 20000)
      } else {
        reject(new Error('Queue undefinied'))
      }
    })
  }

  async getUser (id: string): Promise<DiscordUser> {
    let user = this.cache.get<DiscordUser>(id)
    if (user == null) {
      try {
        user = JSON.parse(await this.send(id, 'getUser'))
        if (user == null) {
          console.error('Fail get user')
        }
        this.cache.set(id, user, 3600)
      } catch (error) {
        console.error('Fail get user', error.message)
      }
    }

    return user as DiscordUser
  }

  sendRemove (bot: Bot, reason: string, author: User): void {
    this.send(JSON.stringify({
      bot: bot,
      reason: reason,
      author: author
    }), 'sendRemove').catch(() => {
      console.error('Falha ao enviar a mensagem que o bot foi removido')
    })
  }
}
