package com.mm.umaster.account.models;

import lombok.Data;

import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;

@Data
public class LoginForm {

    @NotBlank(message = "Email is mandatory")
    @Email(message = "Email format is incorrect")
    String email;

    @NotBlank(message = "Password is mandatory")
    String password;
}
