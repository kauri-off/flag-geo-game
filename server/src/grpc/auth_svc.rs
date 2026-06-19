//! AuthService: discovery, guest auth, account register/login.
use tonic::{Request, Response, Status};

use crate::auth;
use crate::error::AppError;
use crate::pb::auth_service_server::{AuthService, AuthServiceServer};
use crate::pb::{
    AuthRequest, AuthResponse, AuthedAccount, GetInfoRequest, LoginRequest, RegisterRequest,
    ServerInfo,
};
use crate::state::AppState;
use crate::validate;

use super::rate_limit;

pub struct AuthSvc {
    st: AppState,
}

pub fn auth_server(st: AppState) -> AuthServiceServer<AuthSvc> {
    AuthServiceServer::new(AuthSvc { st })
}

#[tonic::async_trait]
impl AuthService for AuthSvc {
    async fn get_info(
        &self,
        _req: Request<GetInfoRequest>,
    ) -> Result<Response<ServerInfo>, Status> {
        let c = &self.st.config;
        Ok(Response::new(ServerInfo {
            name: c.server_name.clone(),
            auth_required: c.auth_required(),
            guests_allowed: c.allow_guests,
            max_players: c.max_players_per_room as u32,
            registration_enabled: true,
        }))
    }

    async fn auth(&self, req: Request<AuthRequest>) -> Result<Response<AuthResponse>, Status> {
        rate_limit(&self.st, &req)?;
        let body = req.into_inner();
        if !self.st.config.allow_guests {
            return Err(AppError::Conflict("this server requires a registered account".into()).into());
        }
        if let Some(expected) = &self.st.config.server_password {
            let supplied = body.password.unwrap_or_default();
            if !auth::server_password_matches(expected, &supplied) {
                return Err(AppError::Unauthorized.into());
            }
        }
        // Reject up front a guest name that belongs to a registered account, so
        // the user gets immediate feedback rather than failing later at room join.
        // (Room join still re-checks: the guest token carries no identity, so this
        // is fail-fast UX, not the security boundary.)
        if let Some(nick) = &body.nickname {
            let nickname = validate::nickname(nick).map_err(Status::from)?;
            if self.st.db.find_user(nickname).await.map_err(Status::from)?.is_some() {
                return Err(AppError::Conflict("this name belongs to a registered account".into()).into());
            }
        }
        let token = auth::issue_session_token(&self.st.config).map_err(Status::from)?;
        Ok(Response::new(AuthResponse { token }))
    }

    async fn register(
        &self,
        req: Request<RegisterRequest>,
    ) -> Result<Response<AuthedAccount>, Status> {
        rate_limit(&self.st, &req)?;
        let body = req.into_inner();
        if let Some(expected) = &self.st.config.server_password {
            let supplied = body.server_password.unwrap_or_default();
            if !auth::server_password_matches(expected, &supplied) {
                return Err(AppError::Unauthorized.into());
            }
        }
        let username = validate::username(&body.username).map_err(Status::from)?;
        validate::password(&body.password).map_err(Status::from)?;
        let avatar = validate::avatar(&body.avatar).map_err(Status::from)?;
        let password_hash = auth::hash_password(&body.password).map_err(Status::from)?;
        let uid = self
            .st
            .db
            .create_user(username.clone(), password_hash, avatar.clone())
            .await
            .map_err(Status::from)?;
        let token = auth::issue_session_token_for_user(&self.st.config, uid, &username)
            .map_err(Status::from)?;
        Ok(Response::new(AuthedAccount { token, username, avatar }))
    }

    async fn login(&self, req: Request<LoginRequest>) -> Result<Response<AuthedAccount>, Status> {
        rate_limit(&self.st, &req)?;
        let body = req.into_inner();
        let user = self
            .st
            .db
            .find_user(body.username.trim().to_string())
            .await
            .map_err(Status::from)?
            .ok_or(AppError::Unauthorized)?;
        if !auth::verify_password(&user.password_hash, &body.password) {
            return Err(AppError::Unauthorized.into());
        }
        let token = auth::issue_session_token_for_user(&self.st.config, user.id, &user.username)
            .map_err(Status::from)?;
        Ok(Response::new(AuthedAccount {
            token,
            username: user.username,
            avatar: user.avatar,
        }))
    }
}
