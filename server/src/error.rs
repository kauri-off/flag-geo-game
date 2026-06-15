//! Single error type for the service handlers. Every fallible path returns
//! `AppError` instead of panicking, so a bad request can never take the process
//! down. Converts into a `tonic::Status` (the gRPC/Connect error) at the RPC
//! boundary; the human message rides along for the client to display.
use tonic::{Code, Status};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("rate limited")]
    RateLimited,
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    fn code(&self) -> Code {
        match self {
            AppError::Unauthorized => Code::Unauthenticated,
            AppError::BadRequest(_) => Code::InvalidArgument,
            AppError::NotFound(_) => Code::NotFound,
            AppError::Conflict(_) => Code::FailedPrecondition,
            AppError::RateLimited => Code::ResourceExhausted,
            AppError::Internal(_) => Code::Internal,
        }
    }
}

impl From<AppError> for Status {
    fn from(err: AppError) -> Status {
        if matches!(err, AppError::Internal(_)) {
            tracing::error!("internal error: {err}");
        }
        Status::new(err.code(), err.to_string())
    }
}
