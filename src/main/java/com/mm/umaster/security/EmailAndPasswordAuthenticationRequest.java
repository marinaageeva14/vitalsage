package com.mm.umaster.security;

import lombok.Data;

@Data
public class EmailAndPasswordAuthenticationRequest {
    private String email;
    private String password;

    public EmailAndPasswordAuthenticationRequest() {

    }
}
