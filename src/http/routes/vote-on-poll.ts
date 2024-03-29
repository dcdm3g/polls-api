import { randomUUID } from 'node:crypto'
import { FastifyInstance } from 'fastify'
import z from 'zod'
import { prisma, redis } from '@/lib'
import { voting } from '@/utils'

export async function voteOnPoll(app: FastifyInstance) {
  app.post('/polls/:pollId/votes', async (request, reply) => {
    const voteOnPollParams = z.object({
      pollId: z.string().uuid(),
    })

    const voteOnPollBody = z.object({
      pollOptionId: z.string().uuid(),
    })

    const { pollId } = voteOnPollParams.parse(request.params)
    const { pollOptionId } = voteOnPollBody.parse(request.body)

    let { sessionId } = request.cookies

    if (sessionId) {
      const userPreviousVoteOnPoll = await prisma.vote.findUnique({
        where: {
          sessionId_pollId: {
            sessionId,
            pollId,
          },
        },
      })

      if (userPreviousVoteOnPoll?.pollOptionId === pollOptionId) {
        return reply
          .status(400)
          .send({ message: 'You already voted on this option' })
      }

      if (userPreviousVoteOnPoll) {
        await prisma.vote.delete({
          where: {
            sessionId_pollId: {
              sessionId,
              pollId,
            },
          },
        })

        const votes = await redis.zincrby(
          pollId,
          -1,
          userPreviousVoteOnPoll.pollOptionId,
        )

        voting.publish(pollId, {
          pollOptionId: userPreviousVoteOnPoll.pollOptionId,
          votes: Number(votes),
        })
      }
    }

    if (!sessionId) {
      sessionId = randomUUID()

      reply.setCookie('sessionId', sessionId, {
        maxAge: 60 * 60 * 24 * 30, // 30 days
        signed: true,
        httpOnly: true,
      })
    }

    await prisma.vote.create({
      data: {
        sessionId,
        pollId,
        pollOptionId,
      },
    })

    const votes = await redis.zincrby(pollId, 1, pollOptionId)

    voting.publish(pollId, {
      pollOptionId,
      votes: Number(votes),
    })

    return reply.status(201).send()
  })
}
