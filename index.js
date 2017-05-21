'use strict';

const Hapi = require('hapi');
const Boom = require('boom');
const request = require('request');
const process = require('process');

const redis = require("redis")
const redisClient = redis.createClient(process.env.REDIS_URI);

const clientIdSecretPair = `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`;
const base64EncodedIdSecretPair = new Buffer(clientIdSecretPair).toString('base64');

const spotifyAuthUrl = "https://accounts.spotify.com/authorize"
const spotifyTokenUrl = "https://accounts.spotify.com/api/token"
const validScopes = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-library-modify",
  "user-read-private",
  "user-read-birthdate",
  "user-read-email",
  "user-follow-read",
  "user-follow-modify",
  "user-top-read",
  "user-read-playback-state",
  "user-read-recently-played",
  "user-read-currently-playing",
  "user-modify-playback-state"
]

function toQueryString(paramsObject) {
  return Object
    .keys(paramsObject)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(paramsObject[key])}`)
    .join('&') ;
}

const server = new Hapi.Server();
server.connection({
  host: '0.0.0.0',
  port: process.env.PORT || 8000
});

const resolveRedirectUri = (req) => {
  return `${req.headers['x-forwarded-proto'] || req.connection.info.protocol}://${req.headers['host'] || req.info.host}/spotifyOauthCallback`
}

server.route({
  method: 'GET',
  path: '/spotifyOauthCallback',
  handler: function (req, reply) {
    if (req.query.state) {
      redisClient.get(req.query.state, (err, redisReply) => {
        if (err) return reply(Boom.badRequest("Invalid State"));
        if (req.query.code) {
          request({
            method: "POST",
            url: spotifyTokenUrl,
            body: toQueryString({
              "grant_type": "authorization_code",
              "code": req.query.code,
              "redirect_uri": encodeURI(resolveRedirectUri(req))
            }),
            headers: {
              "Authorization": `Basic ${base64EncodedIdSecretPair}`,
              "Content-Type": "application/x-www-form-urlencoded",
            }
          }, (err, response, body) => {
            if (err) {
              reply(Boom.badImplementation("Failed request to Spotify Accounts"));
            }
            const jsonResponse = JSON.parse(body);
            reply('x').redirect(`${redisReply.toString()}#${toQueryString(jsonResponse)}`);
          });
        } else {
          // no code - user probably denied. Pass query on to client.
          reply.redirect(`${redisReply.toString()}#${toQueryString(req.query)}`);
        }
      });
    } else {
      // We didn't send state, our bad. This should've been caught earlier.
      reply(Boom.badImplementation("Server Error 500"));
    }
  }
});

server.route({
  method: 'GET',
  path:'/login',
  handler: function (req, reply) {
    if (req.query.client_id &&
      process.env.CLIENT_ID === req.query.client_id) {
        const scopesAreValid = !req.query.scope || req.query.scope.split(',')
          .map(scope => validScopes.indexOf(scope) > -1)
          .reduce((acc, el) => acc && el, true)
        if (scopesAreValid) {
          if (req.query.redirect_uri) {
            const appRedirectUri = req.query.redirect_uri;
            const redirectUri = encodeURI(resolveRedirectUri(req));
            redisClient.set(req.id, appRedirectUri);
            redisClient.expire(req.id, 60*5)
            return (params => reply.redirect(`${spotifyAuthUrl}?${toQueryString(params)}`))(
              Object.assign({
                "client_id": req.query.client_id,
                "response_type": "code",
                "redirect_uri": redirectUri,
                "state": req.id
              }, req.query.scope ? {
                "scope": req.query.scope
              } : {})
            );
          } else {
            return reply(Boom.badRequest("Invalid Redirect URI"));
          }
        } else {
          return reply(Boom.badRequest("Invalid Scopes"));
        }
      } else {
        return reply(Boom.unauthorized("Invalid Client ID"));
      }
  }
});

server.route({
  method: 'GET',
  path: '/refresh',
  handler: function(req, reply) {
    if (req.query.client_id &&
      process.env.CLIENT_ID === req.query.client_id) {
        if (!req.query.refresh_token) {
          return reply(Boom.badRequest("Invalid Refresh Token"));
        }
        request({
          method: "POST",
          url: spotifyTokenUrl,
          body: toQueryString({
            "grant_type": "refresh_token",
            "refresh_token": req.query.refresh_token
          }),
          headers: {
            "Authorization": `Basic ${base64EncodedIdSecretPair}`,
            "Content-Type": "application/x-www-form-urlencoded",
          }
        }, (err, response, body) => {
          if (err) {
            return reply(Boom.badRequest(err));
          }
          return reply(body);
        });
      } else {
        return reply(Boom.unauthorized("Invalid Client ID"));
      }
  }
});

server.route({
  method: 'GET',
  path: '/clientCredentials',
  handler: function(req, reply) {
    if (req.query.client_id &&
      process.env.CLIENT_ID === req.query.client_id) {
        request({
          method: "POST",
          url: spotifyTokenUrl,
          body: "grant_type=client_credentials",
          headers: {
            "Authorization": `Basic ${base64EncodedIdSecretPair}`,
            "Content-Type": "application/x-www-form-urlencoded",
          }
        }, (err, response, body) => {
          return reply(body);
        });
      } else {
        return reply(Boom.unauthorized("Invalid Client ID"));
      }
  }
});

// Start the server
server.start((err) => {
  if (err) {
    throw err;
  }
  console.log('Server running at:', server.info.uri);
});
