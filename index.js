'use strict';

const Hapi = require('hapi');
const Boom = require('boom');
const request = require('request');
const process = require('process');

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

let openRedirects = {
  "yay": "http://localhost:4000"
};

const server = new Hapi.Server();
server.connection({
  host: '0.0.0.0',
  port: process.env.PORT || 8000
});

server.route({
  method: 'GET',
  path: '/spotifyOauthCallback',
  handler: function (req, reply) {
    console.log(req.headers);
    if (!req.query.state) {
      // We didn't send state, our bad. This should've been caught earlier.
      reply(Boom.badImplementation("Server Error 500"));
    }
    if (req.query.code) {
      request({
        method: "POST",
        url: spotifyTokenUrl,
        body: toQueryString({
          "grant_type": "authorization_code",
          "code": req.query.code,
          "redirect_uri": `${req.connection.info.protocol}://${req.info.host}/spotifyOauthCallback`
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
        reply('x').redirect(`${openRedirects[req.query.state]}#${toQueryString(jsonResponse)}`);
      });
    } else {
      // no code - user probably denied. Pass query on to client.
      reply.redirect(`${openRedirects[req.query.state]}#${toQueryString(req.query)}`);
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
          const redirectUri = encodeURI(`${req.connection.info.protocol}://${req.info.host}/spotifyOauthCallback`);
          return (params => reply.redirect(`${spotifyAuthUrl}?${toQueryString(params)}`))(
            Object.assign({
              "client_id": req.query.client_id,
              "response_type": "code",
              "redirect_uri": redirectUri,
              // TODO: Implement the client redirect URI parameter
              "state": "yay"
            }, req.query.scope ? {
              "scope": req.query.scope
            } : {})
          );
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
